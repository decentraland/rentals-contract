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

    function getRentalEnd(address _contractAddress, uint256 _tokenId) external view returns (uint256) {
        return _getRentalEnd(_contractAddress, _tokenId);
    }

    function isRented(address _contractAddress, uint256 _tokenId) external view returns (bool) {
        return _isRented(_contractAddress, _tokenId);
    }

    function rent(Lessor calldata _lessor, Tenant calldata _tenant) external {
        _verify(_lessor, _tenant);

        address lessor = _lessor.signer;
        address tenant = _tenant.signer;
        address contractAddress = _lessor.contractAddress;
        uint256 tokenId = _lessor.tokenId;
        bytes memory fingerprint = _lessor.fingerprint;
        uint256 pricePerDay = _lessor.pricePerDay;
        uint256 _days = _tenant._days;

        if (fingerprint.length > 0) {
            IERC721Verifiable verifiable = IERC721Verifiable(contractAddress);
            require(verifiable.verifyFingerprint(tokenId, fingerprint), "Rentals#rent: INVALID_FINGERPRINT");
        }

        require(!_isRented(contractAddress, tokenId), "Rentals#rent: CURRENTLY_RENTED");

        IERC721Operable asset = IERC721Operable(contractAddress);

        bool isAssetOwnerByContract = asset.ownerOf(tokenId) == address(this);

        if (isAssetOwnerByContract) {
            require(_getOriginalOwner(contractAddress, tokenId) == lessor, "Rentals#rent: NOT_ORIGINAL_OWNER");
        } else {
            originalOwners[contractAddress][tokenId] = lessor;
        }

        ongoingRentals[contractAddress][tokenId] = block.timestamp + _tenant._days * 86400; // 86400 seconds in 1 day

        if (!isAssetOwnerByContract) {
            asset.safeTransferFrom(lessor, address(this), tokenId);
        }

        asset.setUpdateOperator(tokenId, tenant);

        erc20Token.transferFrom(tenant, lessor, pricePerDay * _days);
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

    function _getRentalEnd(address _contractAddress, uint256 _tokenId) internal view returns (uint256) {
        return ongoingRentals[_contractAddress][_tokenId];
    }

    function _isRented(address _contractAddress, uint256 _tokenId) internal view returns (bool) {
        return block.timestamp < _getRentalEnd(_contractAddress, _tokenId);
    }

    function _verify(Lessor calldata _lessor, Tenant calldata _tenant) internal view {
        _verifySignatures(_lessor, _tenant);

        require(_lessor.expiration > block.timestamp, "Rentals#rent: EXPIRED_LESSOR_SIGNATURE");
        require(_tenant.expiration > block.timestamp, "Rentals#rent: EXPIRED_TENANT_SIGNATURE");
        require(_lessor.maxDays >= _lessor.minDays, "Rentals#rent: MAX_DAYS_NOT_GE_THAN_MIN_DAYS");
        require(_tenant._days >= _lessor.minDays && _tenant._days <= _lessor.maxDays, "Rentals#rent: DAYS_NOT_IN_RANGE");
        require(_lessor.pricePerDay == _tenant.pricePerDay, "Rentals#rent: DIFFERENT_PRICE_PER_DAY");
        require(_lessor.contractAddress == _tenant.contractAddress, "Rentals#rent: DIFFERENT_CONTRACT_ADDRESS");
        require(_lessor.tokenId == _tenant.tokenId, "Rentals#rent: DIFFERENT_TOKEN_ID");
        require(keccak256(_lessor.fingerprint) == keccak256(_tenant.fingerprint), "Rentals#rent: DIFFERENT_FINGERPRINT");
        require(_lessor.contractNonce == contractNonce, "Rentals#rent: INVALID_LESSOR_CONTRACT_NONCE");
        require(_tenant.contractNonce == contractNonce, "Rentals#rent: INVALID_TENANT_CONTRACT_NONCE");
        require(_lessor.signerNonce == signerNonce[_lessor.signer], "Rentals#rent: INVALID_LESSOR_SIGNER_NONCE");
        require(_tenant.signerNonce == signerNonce[_tenant.signer], "Rentals#rent: INVALID_TENANT_SIGNER_NONCE");
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

        address lessor = ECDSAUpgradeable.recover(lessorMessageHash, _lessor.signature);
        address tenant = ECDSAUpgradeable.recover(tenantMessageHash, _tenant.signature);

        require(tenant == _tenant.signer, "Rentals#rent: INVALID_TENANT_SIGNATURE");
        require(lessor == _lessor.signer, "Rentals#rent: INVALID_LESSOR_SIGNATURE");
    }

    function _verifySignatureExpiration(uint256 _expiration, string memory _message) internal view {
        require(_expiration > block.timestamp, _message);
    }
}
