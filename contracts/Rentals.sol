// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/draft-EIP712Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import "./interfaces/IERC721Operable.sol";
import "./interfaces/IERC721Verifiable.sol";

contract Rentals is OwnableUpgradeable, EIP712Upgradeable, IERC721Receiver {
    bytes32 public constant LESSOR_TYPE_HASH = 0x94cd8ac6d98067bd9a95107df44b7de06006812e32b3fe2a7ee99c42542d3342;
    bytes32 public constant TENANT_TYPE_HASH = 0x397a65bf420b7775b4c1124dfb4bef955ae58c2e5040df6d14561252db30022f;

    uint256 public constant SECONDS_PER_DAY = 86400;

    IERC20 public token;
    uint256 public contractNonce;
    mapping(address => uint256) public signerNonce;
    mapping(address => mapping(uint256 => mapping(address => uint256))) public assetNonce;
    mapping(address => mapping(uint256 => address)) public originalOwners;
    mapping(address => mapping(uint256 => uint256)) public ongoingRentals;

    struct Lessor {
        address signer;
        address contractAddress;
        uint256 tokenId;
        bytes fingerprint;
        uint256 pricePerDay;
        uint256 expiration;
        uint256 contractNonce;
        uint256 signerNonce;
        uint256 assetNonce;
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
        uint256 assetNonce;
        bytes signature;
        uint256 _days;
    }

    function initialize(address _owner, IERC20 _token) external initializer {
        __EIP712_init("Rentals", "1");
        _setToken(_token);
        _transferOwnership(_owner);
    }

    function setToken(IERC20 _token) external onlyOwner {
        _setToken(_token);
    }

    function bumpContractNonce() external onlyOwner {
        contractNonce++;
    }

    function bumpSignerNonce() external {
        signerNonce[msg.sender]++;
    }

    function bumpAssetNonce(address _contractAddress, uint256 _tokenId) external {
        _bumpAssetNonce(_contractAddress, _tokenId, msg.sender);
    }

    function getAssetNonce(
        address _contractAddress,
        uint256 _tokenId,
        address _signer
    ) external view returns (uint256) {
        return _getAssetNonce(_contractAddress, _tokenId, _signer);
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

        bool isAssetOwnedByContract = _getOriginalOwner(contractAddress, tokenId) != address(0);

        if (isAssetOwnedByContract) {
            require(_getOriginalOwner(contractAddress, tokenId) == lessor, "Rentals#rent: NOT_ORIGINAL_OWNER");
        } else {
            originalOwners[contractAddress][tokenId] = lessor;
        }

        ongoingRentals[contractAddress][tokenId] = block.timestamp + _days * SECONDS_PER_DAY;

        _bumpAssetNonce(contractAddress, tokenId, lessor);
        _bumpAssetNonce(contractAddress, tokenId, tenant);

        if (!isAssetOwnedByContract) {
            asset.safeTransferFrom(lessor, address(this), tokenId);
        }

        asset.setUpdateOperator(tokenId, tenant);

        token.transferFrom(tenant, lessor, pricePerDay * _days);
    }

    function claim(address _contractAddress, uint256 _tokenId) external {
        require(!_isRented(_contractAddress, _tokenId), "Rentals#claim: CURRENTLY_RENTED");
        require(_getOriginalOwner(_contractAddress, _tokenId) == msg.sender, "Rentals#claim: NOT_ORIGINAL_OWNER");

        originalOwners[_contractAddress][_tokenId] = address(0);

        IERC721 asset = IERC721(_contractAddress);

        asset.safeTransferFrom(address(this), msg.sender, _tokenId);
    }

    function setUpdateOperator(
        address _contractAddress,
        uint256 _tokenId,
        address _operator
    ) external {
        require(!_isRented(_contractAddress, _tokenId), "Rentals#setUpdateOperator: CURRENTLY_RENTED");
        require(_getOriginalOwner(_contractAddress, _tokenId) == msg.sender, "Rentals#setUpdateOperator: NOT_ORIGINAL_OWNER");

        IERC721Operable asset = IERC721Operable(_contractAddress);

        asset.setUpdateOperator(_tokenId, _operator);
    }

    function onERC721Received(
        address _operator,
        address, // _from,
        uint256, // _tokenId,
        bytes calldata // _data
    ) external view override returns (bytes4) {
        require(_operator == address(this), "Rentals#onERC721Received: ONLY_ACCEPT_TRANSFERS_FROM_THIS_CONTRACT");
        return 0x150b7a02;
    }

    function _setToken(IERC20 _token) internal {
        token = _token;
    }

    function _bumpAssetNonce(
        address _contractAddress,
        uint256 _tokenId,
        address _signer
    ) internal {
        assetNonce[_contractAddress][_tokenId][_signer]++;
    }

    function _getAssetNonce(
        address _contractAddress,
        uint256 _tokenId,
        address _signer
    ) internal view returns (uint256) {
        return assetNonce[_contractAddress][_tokenId][_signer];
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

        require(_lessor.expiration > block.timestamp, "Rentals#_verify: EXPIRED_LESSOR_SIGNATURE");
        require(_tenant.expiration > block.timestamp, "Rentals#_verify: EXPIRED_TENANT_SIGNATURE");
        require(_lessor.minDays <= _lessor.maxDays, "Rentals#_verify: MAX_DAYS_LOWER_THAN_MIN_DAYS");
        require(_lessor.minDays > 0, "Rentals#_verify: MIN_DAYS_0");
        require(_tenant._days >= _lessor.minDays && _tenant._days <= _lessor.maxDays, "Rentals#_verify: DAYS_NOT_IN_RANGE");
        require(_lessor.pricePerDay == _tenant.pricePerDay, "Rentals#_verify: DIFFERENT_PRICE_PER_DAY");
        require(_lessor.contractAddress == _tenant.contractAddress, "Rentals#_verify: DIFFERENT_CONTRACT_ADDRESS");
        require(_lessor.tokenId == _tenant.tokenId, "Rentals#_verify: DIFFERENT_TOKEN_ID");
        require(keccak256(_lessor.fingerprint) == keccak256(_tenant.fingerprint), "Rentals#_verify: DIFFERENT_FINGERPRINT");
        require(_lessor.contractNonce == contractNonce, "Rentals#_verify: INVALID_LESSOR_CONTRACT_NONCE");
        require(_tenant.contractNonce == contractNonce, "Rentals#_verify: INVALID_TENANT_CONTRACT_NONCE");
        require(_lessor.signerNonce == signerNonce[_lessor.signer], "Rentals#_verify: INVALID_LESSOR_SIGNER_NONCE");
        require(_tenant.signerNonce == signerNonce[_tenant.signer], "Rentals#_verify: INVALID_TENANT_SIGNER_NONCE");

        _verifyAssetNonces(_lessor, _tenant);
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
                    _lessor.assetNonce,
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
                    _tenant.assetNonce,
                    _tenant._days
                )
            )
        );

        address lessor = ECDSAUpgradeable.recover(lessorMessageHash, _lessor.signature);
        address tenant = ECDSAUpgradeable.recover(tenantMessageHash, _tenant.signature);

        require(tenant == _tenant.signer, "Rentals#_verifySignatures: INVALID_TENANT_SIGNATURE");
        require(lessor == _lessor.signer, "Rentals#_verifySignatures: INVALID_LESSOR_SIGNATURE");
    }

    function _verifyAssetNonces(Lessor calldata _lessor, Tenant calldata _tenant) internal view {
        address contractAddress = _lessor.contractAddress;
        uint256 tokenId = _lessor.tokenId;

        uint256 lessorAssetNonce = _getAssetNonce(contractAddress, tokenId, _lessor.signer);
        uint256 tenantAssetNonce = _getAssetNonce(contractAddress, tokenId, _tenant.signer);

        require(_lessor.assetNonce == lessorAssetNonce, "Rentals#_verifyAssetNonces: INVALID_LESSOR_ASSET_NONCE");
        require(_tenant.assetNonce == tenantAssetNonce, "Rentals#_verifyAssetNonces: INVALID_TENANT_ASSET_NONCE");
    }
}
