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
    bytes32 public constant TENANT_TYPE_HASH = 0x0d0b47fba9a245a5961cbb36d53564602f1a196311baa5012e2712eefcd4062e;

    bytes4 public constant IERC721Verifiable_ValidateFingerprint = 0x8f9f4b63;

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
        uint256 rentalDays;
        address operator;
    }

    event TokenSet(IERC20 _token, address _sender);
    event UpdatedContractNonce(uint256 _from, uint256 _to, address _sender);
    event UpdatedSignerNonce(uint256 _from, uint256 _to, address _sender);
    event UpdatedAssetNonce(uint256 _from, uint256 _to, address _contractAddress, uint256 _tokenId, address _signer, address _sender);

    /**
    @notice Initialize the contract.
    @dev Can only be initialized once, This method should be called by an upgradable proxy.
    @param _owner The address of the owner of the contract.
    @param _token The address of the ERC20 token used by tenants to pay rent.
     */
    function initialize(address _owner, IERC20 _token) external initializer {
        __EIP712_init("Rentals", "1");
        _setToken(_token);
        _transferOwnership(_owner);
    }

    /**
    @notice Set the ERC20 token used by tenants to pay rent.
    @param _token The address of the token
     */
    function setToken(IERC20 _token) external onlyOwner {
        _setToken(_token);
    }

    /**
    @notice Increase by 1 the contract nonce
    @dev This can be used to invalidate all signatures created with the previous nonce.
     */
    function bumpContractNonce() external onlyOwner {
        uint256 previous = contractNonce;
        contractNonce++;

        emit UpdatedContractNonce(previous, contractNonce, msg.sender);
    }

    /**
    @notice Increase by 1 the signer nonce
    @dev This can be used to invalidate all signatures created by the caller with the previous nonce.
     */
    function bumpSignerNonce() external {
        uint256 previous = signerNonce[msg.sender];
        signerNonce[msg.sender]++;

        emit UpdatedSignerNonce(previous, signerNonce[msg.sender], msg.sender);
    }

    /**
    @notice Increase by 1 the asset nonce
    @dev This can be used to invalidate all signatures created by the caller for a given asset with the previous nonce.
    @param _contractAddress The contract address of the asset.
    @param _tokenId The token id of the asset.
     */
    function bumpAssetNonce(address _contractAddress, uint256 _tokenId) external {
        _bumpAssetNonce(_contractAddress, _tokenId, msg.sender);
    }

    /**
    @notice Get the asset nonce for a signer.
    @param _contractAddress The contract address of the asset.
    @param _tokenId The token id of the asset.
    @param _signer The address of the user.
    @return The asset nonce.
     */
    function getAssetNonce(
        address _contractAddress,
        uint256 _tokenId,
        address _signer
    ) external view returns (uint256) {
        return _getAssetNonce(_contractAddress, _tokenId, _signer);
    }

    /**
    @notice Get the original owner address of an asset before it was transfered to this contract.
    @param _contractAddress The contract address of the asset.
    @param _tokenId The token id of the asset.
    @return The original owner address or address(0) if there is none.
     */
    function getOriginalOwner(address _contractAddress, uint256 _tokenId) external view returns (address) {
        return _getOriginalOwner(_contractAddress, _tokenId);
    }

    /**
    @notice Get the timestamp of when a rental will end.
    @param _contractAddress The contract address of the asset.
    @param _tokenId The token id of the asset.
    @return The timestamp for when a rental ends or 0 if the asset has not been rented yet.
     */
    function getRentalEnd(address _contractAddress, uint256 _tokenId) external view returns (uint256) {
        return _getRentalEnd(_contractAddress, _tokenId);
    }

    /**
    @notice Get if and asset is currently being rented.
    @param _contractAddress The contract address of the asset.
    @param _tokenId The token id of the asset.
    @return true or false depending if the asset is currently rented
     */
    function isRented(address _contractAddress, uint256 _tokenId) external view returns (bool) {
        return _isRented(_contractAddress, _tokenId);
    }

    /**
    @notice Rent an asset providing the signature of both the lessor and the tenant and a set of matching parameters.
    @param _lessor Data corresponding to the lessor.
    @param _tenant Data corresponding to the tenant.
     */
    function rent(Lessor calldata _lessor, Tenant calldata _tenant) external {
        _verify(_lessor, _tenant);

        address lessor = _lessor.signer;
        address tenant = _tenant.signer;
        address contractAddress = _lessor.contractAddress;
        uint256 tokenId = _lessor.tokenId;
        bytes memory fingerprint = _lessor.fingerprint;
        uint256 pricePerDay = _lessor.pricePerDay;
        uint256 rentalDays = _tenant.rentalDays;
        address operator = _tenant.operator;

        IERC721Verifiable verifiable = IERC721Verifiable(contractAddress);

        if (verifiable.supportsInterface(IERC721Verifiable_ValidateFingerprint)) {
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

        ongoingRentals[contractAddress][tokenId] = block.timestamp + rentalDays * SECONDS_PER_DAY;

        _bumpAssetNonce(contractAddress, tokenId, lessor);
        _bumpAssetNonce(contractAddress, tokenId, tenant);

        if (!isAssetOwnedByContract) {
            asset.safeTransferFrom(lessor, address(this), tokenId);
        }

        asset.setUpdateOperator(tokenId, operator);

        token.transferFrom(tenant, lessor, pricePerDay * rentalDays);
    }

    /**
    @notice The original owner of the asset can claim it back if said asset is not being rented.
    @param _contractAddress The contract address of the asset.
    @param _tokenId The token id of the asset.
     */
    function claim(address _contractAddress, uint256 _tokenId) external {
        require(!_isRented(_contractAddress, _tokenId), "Rentals#claim: CURRENTLY_RENTED");
        require(_getOriginalOwner(_contractAddress, _tokenId) == msg.sender, "Rentals#claim: NOT_ORIGINAL_OWNER");

        originalOwners[_contractAddress][_tokenId] = address(0);

        IERC721 asset = IERC721(_contractAddress);

        asset.safeTransferFrom(address(this), msg.sender, _tokenId);
    }

    /**
    @notice The original owner of the asset change the operator of said asset if it is not currently rented.
    @dev As the operator permission cannot be removed automatically from the tenant after the rent ends, the lessor has to do it manually afterwards.
    @param _contractAddress The contract address of the asset.
    @param _tokenId The token id of the asset.
    @param _operator The address that will have operator privileges over the asset.
     */
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

    /**
    @notice Standard function called by ERC721 contracts whenever a safe transfer occurs.
    @dev The contract only allows safe transfers by itself made by the rent function.
    @param _operator Caller of the safe transfer function.
    */
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

        emit TokenSet(_token, msg.sender);
    }

    function _bumpAssetNonce(
        address _contractAddress,
        uint256 _tokenId,
        address _signer
    ) internal {
        uint256 previous = _getAssetNonce(_contractAddress, _tokenId, _signer);
        assetNonce[_contractAddress][_tokenId][_signer]++;

        emit UpdatedAssetNonce(previous, _getAssetNonce(_contractAddress, _tokenId, _signer), _contractAddress, _tokenId, _signer, msg.sender);
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
        require(_tenant.rentalDays >= _lessor.minDays && _tenant.rentalDays <= _lessor.maxDays, "Rentals#_verify: DAYS_NOT_IN_RANGE");
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
                    _tenant.rentalDays,
                    _tenant.operator
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
