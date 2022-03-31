// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/draft-EIP712Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "./interfaces/IERC721Operable.sol";
import "./interfaces/IERC721Verifiable.sol";

contract Rentals is OwnableUpgradeable, EIP712Upgradeable, IERC721Receiver {
    bytes32 public constant LESSOR_TYPE_HASH =
        keccak256(
            bytes(
                "Lessor(address signer,address contractAddress,uint256 tokenId,bytes fingerprint,uint256 pricePerDay,uint256 expiration,uint256 contractNonce,uint256 signerNonce,uint256 maxDays,uint256 minDays)"
            )
        );

    bytes32 public constant TENANT_TYPE_HASH =
        keccak256(
            bytes(
                "Tenant(address signer,address contractAddress,uint256 tokenId,bytes fingerprint,uint256 pricePerDay,uint256 expiration,uint256 contractNonce,uint256 signerNonce,uint256 _days)"
            )
        );

    IERC20 public erc20Token;
    uint256 public contractNonce;
    mapping(address => uint256) public signerNonce;
    mapping(address => mapping(uint256 => address)) originalOwners;
    mapping(address => mapping(uint256 => uint256)) ongoingRentals;

    struct Lessor {
        address signer;
        address contractAddress;
        uint256 tokenId;
        bytes fingerprint;
        uint256 pricePerDay;
        uint256 expiration;
        uint256 contractNonce;
        uint256 signerNonce;
        bytes signature;
        uint256 maxDays;
        uint256 minDays;
    }

    struct Tenant {
        address signer;
        address contractAddress;
        uint256 tokenId;
        bytes fingerprint;
        uint256 pricePerDay;
        uint256 expiration;
        uint256 contractNonce;
        uint256 signerNonce;
        bytes signature;
        uint256 _days;
    }

    function initialize(address _owner, IERC20 _erc20Token) external initializer {
        __EIP712_init("Rentals", "1");
        _setERC20Token(_erc20Token);
        _transferOwnership(_owner);
    }

    function setERC20Token(IERC20 _erc20Token) external onlyOwner {
        _setERC20Token(_erc20Token);
    }

    function bumpContractNonce() external onlyOwner {
        contractNonce++;
    }

    function bumpSignerNonce() external {
        signerNonce[msg.sender]++;
    }

    function getOriginalOwner(address _contractAddress, uint256 _tokenId) external view returns (address) {
        return _getOriginalOwner(_contractAddress, _tokenId);
    }

    function getRentalEndTimestamp(address _contractAddress, uint256 _tokenId) external view returns (uint256) {
        return _getRentalEndTimestamp(_contractAddress, _tokenId);
    }

    function getIsRentalActive(address _contractAddress, uint256 _tokenId) external view returns (bool) {
        return _getIsRentalActive(_contractAddress, _tokenId);
    }

    function rent(Lessor calldata _lessor, Tenant calldata _tenant) external {
        _verifyRent(_lessor, _tenant);

        require(_lessor.maxDays >= _lessor.minDays, "Rentals#rent: MAX_DAYS_NOT_GE_THAN_MIN_DAYS");

        require(
            _tenant._days >= _lessor.minDays && _tenant._days <= _lessor.maxDays,
            "Rentals#rent: DAYS_NOT_IN_RANGE"
        );

        // Validate both signers provided the same price per day
        require(_lessor.pricePerDay == _tenant.pricePerDay, "Rentals#rent: DIFFERENT_PRICE_PER_DAY");

        // Validate both signers provided the same contract address
        require(_lessor.contractAddress == _tenant.contractAddress, "Rentals#rent: DIFFERENT_CONTRACT_ADDRESS");

        // Validate both signers provided the same tokenId
        require(_lessor.tokenId == _tenant.tokenId, "Rentals#rent: DIFFERENT_TOKEN_ID");

        // Validate both signers provided the same fingerprint
        require(
            keccak256(_lessor.fingerprint) == keccak256(_tenant.fingerprint),
            "Rentals#rent: DIFFERENT_FINGERPRINT"
        );

        // Validate the contract nonce provided by the owner has the same value as the contract
        require(_lessor.contractNonce == contractNonce, "Rentals#rent: INVALID_LESSOR_CONTRACT_NONCE");

        // Validate the contract nonce provided by the user has the same value as the contract
        require(_tenant.contractNonce == contractNonce, "Rentals#rent: INVALID_TENANT_CONTRACT_NONCE");

        // Validate the signer nonce provided by the owner has the same value as the one stored in the contract
        require(_lessor.signerNonce == signerNonce[_lessor.signer], "Rentals#rent: INVALID_LESSOR_SIGNER_NONCE");

        // Validate the signer nonce provided by the user has the same value as the one stored in the contract
        require(_tenant.signerNonce == signerNonce[_tenant.signer], "Rentals#rent: INVALID_TENANT_SIGNER_NONCE");

        // If a fingerprint is provided, check that
        if (_lessor.fingerprint.length > 0) {
            IERC721Verifiable verifiable = IERC721Verifiable(_lessor.contractAddress);

            bool isValidFingerprint = verifiable.verifyFingerprint(_lessor.tokenId, _lessor.fingerprint);

            require(isValidFingerprint, "Rentals#rent: INVALID_FINGERPRINT");
        }

        // Validate that the asset is not currently being rented
        require(!_getIsRentalActive(_lessor.contractAddress, _lessor.tokenId), "Rentals#rent: CURRENTLY_RENTED");

        IERC721Operable erc721 = IERC721Operable(_lessor.contractAddress);

        bool isOwnedByContract = erc721.ownerOf(_lessor.tokenId) == address(this);

        // Check if the rental contract already owns the asset the signer wants to rent.
        if (isOwnedByContract) {
            // Validate that the provided owner is the original owner of the asset.
            require(
                _getOriginalOwner(_lessor.contractAddress, _lessor.tokenId) == _lessor.signer,
                "Rentals#rent: NOT_ORIGINAL_OWNER"
            );
        } else {
            // Track the original owner of the asset so they can interact
            originalOwners[_lessor.contractAddress][_lessor.tokenId] = _lessor.signer;
        }

        // Update the ongoing rental end timestamp for this asset. Maybe move before the transfer for reentrancy safety
        ongoingRentals[_lessor.contractAddress][_lessor.tokenId] = block.timestamp + _tenant._days * 86400; // 86400 seconds in 1 day

        // If the contract does not already have the asset, transfer it from the original owner.
        if (!isOwnedByContract) {
            erc721.safeTransferFrom(_lessor.signer, address(this), _lessor.tokenId);
        }

        // Set the interested user as the operator of the asset.
        erc721.setUpdateOperator(_lessor.tokenId, _tenant.signer);

        // Transfer the tokens from the user to the owner of the asset.
        erc20Token.transferFrom(_tenant.signer, _lessor.signer, _tenant.pricePerDay * _tenant._days);
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

    function _getOriginalOwner(address _contractAddress, uint256 _tokenId) internal view returns (address) {
        return originalOwners[_contractAddress][_tokenId];
    }

    function _getRentalEndTimestamp(address _contractAddress, uint256 _tokenId) internal view returns (uint256) {
        return ongoingRentals[_contractAddress][_tokenId];
    }

    function _getIsRentalActive(address _contractAddress, uint256 _tokenId) internal view returns (bool) {
        return block.timestamp < _getRentalEndTimestamp(_contractAddress, _tokenId);
    }

    function _verifyRent(Lessor calldata _lessor, Tenant calldata _tenant) internal view {
        _verifySignatures(_lessor, _tenant);
        _verifySignatureExpiration(_lessor.expiration, "Rentals#rent: EXPIRED_LESSOR_SIGNATURE");
        _verifySignatureExpiration(_tenant.expiration, "Rentals#rent: EXPIRED_TENANT_SIGNATURE");
    }

    function _verifySignatures(Lessor calldata _lessor, Tenant calldata _tenant) internal view {
        bytes32 lessorMessageHash = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    LESSOR_TYPE_HASH,
                    _lessor.signer,
                    _lessor.contractAddress,
                    _lessor.tokenId,
                    keccak256(_lessor.fingerprint),
                    _lessor.pricePerDay,
                    _lessor.expiration,
                    _lessor.contractNonce,
                    _lessor.signerNonce,
                    _lessor.maxDays,
                    _lessor.minDays
                )
            )
        );

        address lessor = ECDSAUpgradeable.recover(lessorMessageHash, _lessor.signature);

        require(lessor == _lessor.signer, "Rentals#rent: INVALID_LESSOR_SIGNATURE");

        bytes32 tenantMessageHash = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    TENANT_TYPE_HASH,
                    _tenant.signer,
                    _tenant.contractAddress,
                    _tenant.tokenId,
                    keccak256(_tenant.fingerprint),
                    _tenant.pricePerDay,
                    _tenant.expiration,
                    _tenant.contractNonce,
                    _tenant.signerNonce,
                    _tenant._days
                )
            )
        );

        address tenant = ECDSAUpgradeable.recover(tenantMessageHash, _tenant.signature);

        require(tenant == _tenant.signer, "Rentals#rent: INVALID_TENANT_SIGNATURE");
    }

    function _verifySignatureExpiration(uint256 _expiration, string memory _message) internal view {
        require(_expiration > block.timestamp, _message);
    }
}
