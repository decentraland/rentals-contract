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
                "OwnerRent(address owner,address contractAddress,uint256 tokenId,bytes fingerprint,uint256 maxDays,uint256 minDays,uint256 pricePerDay,uint256 expiration,uint256 rentalNonce)"
            )
        );

    bytes32 public constant USER_RENT_TYPE_HASH =
        keccak256(
            bytes(
                "UserRent(address user,address contractAddress,uint256 tokenId,bytes fingerprint,uint256 _days,uint256 pricePerDay,uint256 expiration,uint256 rentalNonce,uint256 offerNonce)"
            )
        );

    // Token that will be transfered from the user to the owner when a rent starts.
    IERC20 public erc20Token;

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
        // Rental nonce for this asset.
        uint256 rentalNonce;
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
        // Rental nonce for this asset
        uint256 rentalNonce;
        // Offer nonce for this asset
        uint256 offerNonce;
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

    /// @notice Set the token used by users to pay the rent
    /// @param _erc20Token - Address of the token
    function setERC20Token(IERC20 _erc20Token) external onlyOwner {
        _setERC20Token(_erc20Token);
    }

    function rent(OwnerRentParams calldata _ownerRentParams, UserRentParams calldata _userRentParams) external view {
        _validateOwnerRentSigner(_ownerRentParams);
        _validateUserRentSigner(_userRentParams);

        // Validate signature expirations
        require(_ownerRentParams.expiration > block.timestamp, "Rentals#rent: EXPIRED_OWNER_SIGNATURE");
        require(_userRentParams.expiration > block.timestamp, "Rentals#rent: EXPIRED_USER_SIGNATURE");

        // Validate max days is higher or equal to min days
        require(_ownerRentParams.maxDays >= _ownerRentParams.minDays, "Rentals#rent: MAX_DAYS_NOT_GE_THAN_MIN_DAYS");

        // Validate user days is within range of owner min and max days
        require(
            _userRentParams._days >= _ownerRentParams.minDays && _userRentParams._days <= _ownerRentParams.maxDays,
            "Rentals#rent: DAYS_NOT_IN_RANGE"
        );
    }

    // function rent(OwnerRentParams calldata _renterParams, uint256 _days) external {
    //     // Validate renter signature
    //     bytes32 renterMessageHash = _hashTypedDataV4(
    //         keccak256(
    //             abi.encode(
    //                 RENTER_SIGN_DATA_TYPEHASH,
    //                 _renterParams.renter,
    //                 _renterParams.maxDays,
    //                 _renterParams.price,
    //                 _renterParams.expiration,
    //                 _renterParams.tokenAddress,
    //                 _renterParams.tokenId,
    //                 keccak256(_renterParams.fingerprint),
    //                 _renterParams.salt
    //             )
    //         )
    //     );

    //     address renter = ECDSAUpgradeable.recover(renterMessageHash, _renterParams.sig);

    //     require(renter == _renterParams.renter, "Rentals#rent: SIGNER_NOT_RENTER");

    //     // Validate parameters
    //     require(_renterParams.price > 0, "Rentals#rent: INVALID_PRICE");
    //     require(block.timestamp < _renterParams.expiration, "Rentals#rent: EXPIRED");
    //     require(_days <= _renterParams.maxDays, "Rentals#rent: TOO_MANY_DAYS");
    //     require(_days != 0, "Rentals#rent: ZERO_DAYS");
    //     require(msg.sender != _renterParams.renter, "Rentals#rent: RENTER_CANNOT_BE_TENANT");

    //     // Validate NFT address
    //     Require._ERC721(_renterParams.tokenAddress);
    //     Require._composableERC721(_renterParams.tokenAddress, _renterParams.tokenId, _renterParams.fingerprint);

    //     // Transfer ERC721 token to the rentals contract
    //     IERC721(_renterParams.tokenAddress).safeTransferFrom(renter, address(this), _renterParams.tokenId);

    //     // Transfer ERC20 token from tenant to renter
    //     erc20Token.transferFrom(msg.sender, renter, _renterParams.price);

    //     // Reject the renter signature so it cannot be used again
    //     _rejectSignature(_renterParams.sig);
    // }

    // function rejectSignatures(bytes[] memory _sigs) external {
    //     require(_sigs.length > 0, "Rentals#rejectSignatures: EMPTY_SIGNATURE_ARRAY");

    //     for (uint256 i = 0; i < _sigs.length; i++) {
    //         _rejectSignature(_sigs[i]);
    //     }
    // }

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

    function _validateOwnerRentSigner(OwnerRentParams calldata _ownerRentParams) internal view {
        bytes32 messageHash = _hashTypedDataV4(
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
                    _ownerRentParams.rentalNonce
                )
            )
        );

        require(
            ECDSAUpgradeable.recover(messageHash, _ownerRentParams.signature) == _ownerRentParams.owner,
            "Rentals#_validateOwnerRentSigner: INVALID_OWNER_RENT_SIGNATURE"
        );
    }

    function _validateUserRentSigner(UserRentParams calldata _userRentParams) internal view {
        bytes32 messageHash = _hashTypedDataV4(
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
                    _userRentParams.rentalNonce,
                    _userRentParams.offerNonce
                )
            )
        );

        require(
            ECDSAUpgradeable.recover(messageHash, _userRentParams.signature) == _userRentParams.user,
            "Rentals#_validateUserRentSigner: INVALID_USER_RENT_SIGNATURE"
        );
    }

    // function _rejectSignature(bytes memory _sig) internal {
    //     require(_sig.length == 65, "Rentals#rejectSignature: INVALID_SIGNATURE_LENGTH");
    //     require(!isSignatureRejected[_sig], "Rentals#rejectSignature: ALREADY_REJECTED");

    //     isSignatureRejected[_sig] = true;
    // }
}
