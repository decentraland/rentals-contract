// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/draft-EIP712Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "hardhat/console.sol";

import "./libraries/Require.sol";

contract Rentals is OwnableUpgradeable, EIP712Upgradeable, IERC721Receiver {
    bytes32 public constant OWNER_RENT_TYPE_HASH =
        keccak256(
            bytes(
                "OwnerRent(address owner,address contractAddress,uint256 tokenId,bytes fingerprint,uint256 maxDays,uint256 minDays,uint256 pricePerDay,uint256 expiration,uint256 contractNonce,uint256 signerNonce)"
            )
        );

    bytes32 public constant USER_RENT_TYPE_HASH =
        keccak256(
            bytes(
                "UserRent(address user,address contractAddress,uint256 tokenId,bytes fingerprint,uint256 _days,uint256 pricePerDay,uint256 expiration,uint256 contractNonce,uint256 signerNonce)"
            )
        );

    // Token that will be transfered from the user to the owner when a rent starts.
    IERC20 public erc20Token;

    // To be valid, signatures must be created with the current contractNonce. The owner of the contract
    // can update this value anytime to render any signature with different values than this one invalid.
    // For example, in the case of an off-chain data-breach.
    uint256 public contractNonce;

    // Signers can disable signatures created with a different nonce by changing the nonce for their address
    mapping(address => uint256) public signerNonce;

    // Stores who the owner of an asset was before being transfered to the contract.
    // Useful when claiming the asset back or starting a new rental without the original owner having to claim it back.
    // Schema: contractAddress -> tokenId -> originalOwnerAddress
    // Whenever the asset is claimed back the address goes back to address(0)
    mapping(address => mapping(uint256 => address)) originalOwners;

    // Stores current rentals by providing the ending timestamp for a given asset.
    // Schema: contractAddress -> tokenId -> rentalEndTimestamp.
    // If the block timestamp is higher than the rental end timestamp is because the rental has finished.
    mapping(address => mapping(uint256 => uint256)) ongoingRentals;

    struct OwnerRentParams {
        // Address of the user that wants to rent the asset.
        address owner;
        // Contract address of the asset.
        address contractAddress;
        // Token id of the asset.
        uint256 tokenId;
        // Fingerprint in the case the asset is a composable erc721.
        bytes fingerprint;
        // Maximum amount of days the owner is willing to rent the asset.
        uint256 maxDays;
        // Minimum amount of days the owner is willing to rent the asset.
        uint256 minDays;
        // Price per day to be paid in `erc20Token`.
        uint256 pricePerDay;
        // Timestamp for when the signature will become invalidated.
        uint256 expiration;
        // Value used to create the signature. Invalid if it does not match the current nonce of the contract.
        uint256 contractNonce;
        // Value used to create the signature. Invalid if it does not match the current nonce of the owner.
        uint256 signerNonce;
        // Signature generated off-chain by the user.
        bytes signature;
    }

    struct UserRentParams {
        // Address of the user that wants to rent the asset
        address user;
        // Contract address of the asset
        address contractAddress;
        // Token id of the asset
        uint256 tokenId;
        // Fingerprint in the case the asset is a composable erc721
        bytes fingerprint;
        // Days the user wants to rent the asset
        uint256 _days;
        // Price per day to be paid in `erc20Token`
        uint256 pricePerDay;
        // Timestamp for when the signature will become invalidated
        uint256 expiration;
        // Value used to create the signature. Invalid if it does not match the current nonce of the contract.
        uint256 contractNonce;
        // Value used to create the signature. Invalid if it does not match the current nonce of the user.
        uint256 signerNonce;
        // Signature generated off-chain by the user
        bytes signature;
    }

    /// @notice Initialize the contract with the given values.
    /// @dev Intended to be initialized by upgradeable proxies.
    /// @param _owner - Address of the owner of the contract.
    /// @param _erc20Token - Address of the token paid by users to rent an asset.
    function initialize(address _owner, IERC20 _erc20Token) external initializer {
        __EIP712_init("Rentals", "1");
        _setERC20Token(_erc20Token);
        _transferOwnership(_owner);
    }

    /// @notice Set the token used by users to pay the rent.
    /// @param _erc20Token - Address of the token.
    function setERC20Token(IERC20 _erc20Token) external onlyOwner {
        _setERC20Token(_erc20Token);
    }

    /// @notice Increase the contract nonce by 1.
    /// @dev This can be used by the owner of the contract to invalidate any signature created with any previous nonce.
    function bumpContractNonce() external onlyOwner {
        contractNonce++;
    }

    /// @notice Increase the corresponding signer nonce by 1.
    /// @dev This can be used by a signer to invalidate any signature created by them with any previous nonce.
    function bumpSignerNonce() external {
        signerNonce[msg.sender]++;
    }

    /// @notice Initiate a rental by provide parameters and signatures for the owner of the asset and the user that is interested in the asset.
    /// @param _ownerRentParams - Struct containing the signature of the owner of the asset and the different parameters used to create it.
    /// @param _userRentParams - Struct containing the signature of the user interested in the asset and the different parameters used to create it.
    function rent(OwnerRentParams calldata _ownerRentParams, UserRentParams calldata _userRentParams) external {
        bytes32 ownerRentMessageHash = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    OWNER_RENT_TYPE_HASH,
                    _ownerRentParams.owner,
                    _ownerRentParams.contractAddress,
                    _ownerRentParams.tokenId,
                    keccak256(_ownerRentParams.fingerprint),
                    _ownerRentParams.maxDays,
                    _ownerRentParams.minDays,
                    _ownerRentParams.pricePerDay,
                    _ownerRentParams.expiration,
                    _ownerRentParams.contractNonce,
                    _ownerRentParams.signerNonce
                )
            )
        );

        bytes32 userRentMessageHash = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    USER_RENT_TYPE_HASH,
                    _userRentParams.user,
                    _userRentParams.contractAddress,
                    _userRentParams.tokenId,
                    keccak256(_userRentParams.fingerprint),
                    _userRentParams._days,
                    _userRentParams.pricePerDay,
                    _userRentParams.expiration,
                    _userRentParams.contractNonce,
                    _userRentParams.signerNonce
                )
            )
        );

        // Validate that the owner signature was created by the same owner provided in the params
        require(
            ECDSAUpgradeable.recover(ownerRentMessageHash, _ownerRentParams.signature) == _ownerRentParams.owner,
            "Rentals#rent: INVALID_OWNER_RENT_SIGNATURE"
        );

        // Validate that the user signature was created by the same user provided in the params
        require(
            ECDSAUpgradeable.recover(userRentMessageHash, _userRentParams.signature) == _userRentParams.user,
            "Rentals#rent: INVALID_USER_RENT_SIGNATURE"
        );

        // Validate owner signature expiration
        require(_ownerRentParams.expiration > block.timestamp, "Rentals#rent: EXPIRED_OWNER_SIGNATURE");

        // Validate user signature expirations
        require(_userRentParams.expiration > block.timestamp, "Rentals#rent: EXPIRED_USER_SIGNATURE");

        // Validate max days is higher or equal to min days
        require(_ownerRentParams.maxDays >= _ownerRentParams.minDays, "Rentals#rent: MAX_DAYS_NOT_GE_THAN_MIN_DAYS");

        // Validate user days is within range of owner min and max days
        require(
            _userRentParams._days >= _ownerRentParams.minDays && _userRentParams._days <= _ownerRentParams.maxDays,
            "Rentals#rent: DAYS_NOT_IN_RANGE"
        );

        // Validate both signers provided the same price per day
        require(_ownerRentParams.pricePerDay == _userRentParams.pricePerDay, "Rentals#rent: DIFFERENT_PRICE_PER_DAY");

        // Validate both signers provided the same contract address
        require(
            _ownerRentParams.contractAddress == _userRentParams.contractAddress,
            "Rentals#rent: DIFFERENT_CONTRACT_ADDRESS"
        );

        // Validate both signers provided the same tokenId
        require(_ownerRentParams.tokenId == _userRentParams.tokenId, "Rentals#rent: DIFFERENT_TOKEN_ID");

        // Validate both signers provided the same fingerprint
        require(
            keccak256(_ownerRentParams.fingerprint) == keccak256(_userRentParams.fingerprint),
            "Rentals#rent: DIFFERENT_FINGERPRINT"
        );

        // Validate the contract nonce provided by the owner has the same value as the contract
        require(_ownerRentParams.contractNonce == contractNonce, "Rentals#rent: INVALID_OWNER_CONTRACT_NONCE");

        // Validate the contract nonce provided by the user has the same value as the contract
        require(_userRentParams.contractNonce == contractNonce, "Rentals#rent: INVALID_USER_CONTRACT_NONCE");

        // Validate the signer nonce provided by the owner has the same value as the one stored in the contract
        require(
            _ownerRentParams.signerNonce == signerNonce[_ownerRentParams.owner],
            "Rentals#rent: INVALID_OWNER_SIGNER_NONCE"
        );

        // Validate the signer nonce provided by the user has the same value as the one stored in the contract
        require(
            _userRentParams.signerNonce == signerNonce[_userRentParams.user],
            "Rentals#rent: INVALID_USER_SIGNER_NONCE"
        );

        // Validate that the address provided belongs to an ERC721
        Require.isERC721(_ownerRentParams.contractAddress);

        // Validate that the asset is a composable ERC721 if fingerprint is provided and that the fingerprint is valid
        if (_ownerRentParams.fingerprint.length > 0) {
            Require.isComposableERC721(
                _ownerRentParams.contractAddress,
                _ownerRentParams.tokenId,
                _ownerRentParams.fingerprint
            );
        }

        // Validate that the asset is not currently being rented
        require(
            ongoingRentals[_ownerRentParams.contractAddress][_ownerRentParams.tokenId] == 0 ||
                // Not <= because if 2 rentals are sent in the same block the time will be the same an be valid for the require.
                ongoingRentals[_ownerRentParams.contractAddress][_ownerRentParams.tokenId] < block.timestamp,
            "Rentals#rent: CURRENTLY_RENTED"
        );

        IERC721 erc721 = IERC721(_ownerRentParams.contractAddress);

        // Check if the rental contract already owns the asset the signer wants to rent.
        if (erc721.ownerOf(_ownerRentParams.tokenId) == address(this)) {
            // Validate that the provided owner is the original owner of the asset.
            require(
                originalOwners[_ownerRentParams.contractAddress][_ownerRentParams.tokenId] == _ownerRentParams.owner,
                "Rentals#rent: NOT_ORIGINAL_OWNER"
            );
        }
        // If the contract does not own the asset, transfer it from the original owner to it and keep track of it.
        else {
            originalOwners[_ownerRentParams.contractAddress][_ownerRentParams.tokenId] = _ownerRentParams.owner;
            // TODO: Reentrancy? Maybe call the transfer after all state changes were made.
            erc721.safeTransferFrom(_ownerRentParams.owner, address(this), _ownerRentParams.tokenId);
        }

        // Transfer the tokens from the user to the owner of the asset.
        erc20Token.transferFrom(
            _userRentParams.user,
            _ownerRentParams.owner,
            _userRentParams.pricePerDay * _userRentParams._days
        );

        // Update the ongoing rental end timestamp for this asset. Maybe move before the transfer for reentrancy safety
        ongoingRentals[_ownerRentParams.contractAddress][_ownerRentParams.tokenId] =
            block.timestamp +
            _userRentParams._days *
            86400; // 86400 seconds in 1 day
    }

    function onERC721Received(
        address, // operator,
        address, // from,
        uint256, // tokenId,
        bytes calldata // data
    ) external pure override returns (bytes4) {
        // This is supposed to be used so no nfts are locked within the contract in an unnatural way.
        // Maybe reverting here would be the correct way to use it.
        return 0x150b7a02;
    }

    // Private functions
    function _setERC20Token(IERC20 _erc20Token) internal {
        erc20Token = _erc20Token;
    }
}
