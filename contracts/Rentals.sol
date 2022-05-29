// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import "./external/OwnableUpgradeable.sol";

import "./commons/NativeMetaTransaction.sol";

import "./interfaces/IERC721Operable.sol";
import "./interfaces/IERC721Verifiable.sol";

contract Rentals is OwnableUpgradeable, NativeMetaTransaction, IERC721Receiver {
    bytes32 public constant LESSOR_TYPE_HASH = 0xc051b116252f94829974cd91d68dd970ccc3e78b22bcaa50ea8b15e76dfdc1fb;
    bytes32 public constant TENANT_TYPE_HASH = 0x61d73ea8cac070a687225b3c47827c383d42eb1fcc213dcf09f3fabc51d04db0;

    uint256 public contractNonce;
    mapping(address => uint256) public signerNonce;
    mapping(address => mapping(uint256 => mapping(address => uint256))) public assetNonce;
    
    IERC20 public token;

    mapping(address => mapping(uint256 => address)) public originalOwners;
    mapping(address => mapping(uint256 => uint256)) public ongoingRentals;

    address public feeCollector;
    uint256 public fee;

    struct Lessor {
        address signer;
        address contractAddress;
        uint256 tokenId;
        bytes fingerprint;
        uint256 expiration;
        uint256[3] nonces;
        uint256[] pricePerDay;
        uint256[] maxDays;
        uint256[] minDays;
        bytes signature;
    }

    struct Tenant {
        address signer;
        address contractAddress;
        uint256 tokenId;
        bytes fingerprint;
        uint256 expiration;
        uint256[3] nonces;
        uint256 pricePerDay;
        uint256 rentalDays;
        address operator;
        uint256 index;
        bytes signature;
    }

    event TokenUpdated(IERC20 _from, IERC20 _to, address _sender);
    event FeeCollectorUpdated(address _from, address _to, address _sender);
    event FeeUpdated(uint256 _from, uint256 _to, address _sender);
    event ContractNonceUpdated(uint256 _from, uint256 _to, address _sender);
    event SignerNonceUpdated(uint256 _from, uint256 _to, address _sender);
    event AssetNonceUpdated(uint256 _from, uint256 _to, address _contractAddress, uint256 _tokenId, address _signer, address _sender);
    event RentalStarted(
        address _contractAddress,
        uint256 _tokenId,
        address _lessor,
        address _tenant,
        address _operator,
        uint256 _rentalDays,
        uint256 _pricePerDay,
        address _sender
    );
    event AssetClaimed(address _contractAddress, uint256 _tokenId, address _sender);
    event OperatorUpdated(address _contractAddress, uint256 _tokenId, address _to, address _sender);

    /**
    @notice Initialize the contract.
    @dev Can only be initialized once, This method should be called by an upgradable proxy.
    @param _owner The address of the owner of the contract.
    @param _token The address of the ERC20 token used by tenants to pay rent.
    @param _feeCollector Address that will receive rental fees
    @param _fee Fee (per million wei) that will be transfered from the rental price to the fee collector.
     */
    function initialize(
        address _owner,
        IERC20 _token,
        address _feeCollector,
        uint256 _fee
    ) external initializer {
        __EIP712_init("Rentals", "1");
        _setToken(_token);
        _transferOwnership(_owner);
        _setFeeCollector(_feeCollector);
        _setFee(_fee);
    }

    /**
    @notice Set the ERC20 token used by tenants to pay rent.
    @param _token The address of the token
     */
    function setToken(IERC20 _token) external onlyOwner {
        _setToken(_token);
    }

    /**
    @notice Set the address of the fee collector.
    @param _feeCollector The address of the fee collector.
     */
    function setFeeCollector(address _feeCollector) external onlyOwner {
        _setFeeCollector(_feeCollector);
    }

    /**
    @notice Set the fee (per million wei) for rentals.
    @param _fee The value for the fee.
     */
    function setFee(uint256 _fee) external onlyOwner {
        _setFee(_fee);
    }

    /**
    @notice Increase by 1 the contract nonce
    @dev This can be used to invalidate all signatures created with the previous nonce.
     */
    function bumpContractNonce() external onlyOwner {
        uint256 previous = contractNonce;
        contractNonce++;

        emit ContractNonceUpdated(previous, contractNonce, _msgSender());
    }

    /**
    @notice Increase by 1 the signer nonce
    @dev This can be used to invalidate all signatures created by the caller with the previous nonce.
     */
    function bumpSignerNonce() external {
        address sender = _msgSender();
        uint256 previous = signerNonce[sender];
        signerNonce[sender]++;

        emit SignerNonceUpdated(previous, signerNonce[sender], sender);
    }

    /**
    @notice Increase by 1 the asset nonce
    @dev This can be used to invalidate all signatures created by the caller for a given asset with the previous nonce.
    @param _contractAddress The contract address of the asset.
    @param _tokenId The token id of the asset.
     */
    function bumpAssetNonce(address _contractAddress, uint256 _tokenId) external {
        _bumpAssetNonce(_contractAddress, _tokenId, _msgSender());
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
        uint256 pricePerDay = _lessor.pricePerDay[_tenant.index];
        uint256 rentalDays = _tenant.rentalDays;
        address operator = _tenant.operator;

        IERC721Verifiable verifiable = IERC721Verifiable(contractAddress);

        if (verifiable.supportsInterface(0x8f9f4b63)) {
            require(verifiable.verifyFingerprint(tokenId, _lessor.fingerprint), "Rentals#rent: INVALID_FINGERPRINT");
        }

        require(!_isRented(contractAddress, tokenId), "Rentals#rent: CURRENTLY_RENTED");

        IERC721Operable asset = IERC721Operable(contractAddress);

        bool isAssetOwnedByContract = _getOriginalOwner(contractAddress, tokenId) != address(0);

        if (isAssetOwnedByContract) {
            require(_getOriginalOwner(contractAddress, tokenId) == lessor, "Rentals#rent: NOT_ORIGINAL_OWNER");
        } else {
            originalOwners[contractAddress][tokenId] = lessor;
        }

        ongoingRentals[contractAddress][tokenId] = block.timestamp + rentalDays * 86400; // 86400 = seconds in a day

        _bumpAssetNonce(contractAddress, tokenId, lessor);
        _bumpAssetNonce(contractAddress, tokenId, tenant);

        if (pricePerDay > 0) {
            uint256 totalPrice = pricePerDay * rentalDays;
            uint256 forCollector = (totalPrice * fee) / 1_000_000;

            token.transferFrom(tenant, lessor, totalPrice - forCollector);
            token.transferFrom(tenant, feeCollector, forCollector);
        }

        if (!isAssetOwnedByContract) {
            asset.safeTransferFrom(lessor, address(this), tokenId);
        }

        asset.setUpdateOperator(tokenId, operator);

        emit RentalStarted(contractAddress, tokenId, lessor, tenant, operator, rentalDays, pricePerDay, _msgSender());
    }

    /**
    @notice The original owner of the asset can claim it back if said asset is not being rented.
    @param _contractAddress The contract address of the asset.
    @param _tokenId The token id of the asset.
     */
    function claim(address _contractAddress, uint256 _tokenId) external {
        address sender = _msgSender();

        require(!_isRented(_contractAddress, _tokenId), "Rentals#claim: CURRENTLY_RENTED");
        require(_getOriginalOwner(_contractAddress, _tokenId) == sender, "Rentals#claim: NOT_ORIGINAL_OWNER");

        originalOwners[_contractAddress][_tokenId] = address(0);

        IERC721 asset = IERC721(_contractAddress);

        asset.safeTransferFrom(address(this), sender, _tokenId);

        emit AssetClaimed(_contractAddress, _tokenId, sender);
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
        address sender = _msgSender();

        require(!_isRented(_contractAddress, _tokenId), "Rentals#setUpdateOperator: CURRENTLY_RENTED");
        require(_getOriginalOwner(_contractAddress, _tokenId) == sender, "Rentals#setUpdateOperator: NOT_ORIGINAL_OWNER");

        IERC721Operable asset = IERC721Operable(_contractAddress);

        asset.setUpdateOperator(_tokenId, _operator);

        emit OperatorUpdated(_contractAddress, _tokenId, _operator, sender);
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
        emit TokenUpdated(token, _token, _msgSender());

        token = _token;
    }

    function _setFeeCollector(address _feeCollector) internal {
        emit FeeCollectorUpdated(feeCollector, _feeCollector, _msgSender());

        feeCollector = _feeCollector;
    }

    function _setFee(uint256 _fee) internal {
        require(_fee <= 1_000_000, "Rentals#_setFee: HIGHER_THAN_1000000");

        emit FeeUpdated(fee, _fee, _msgSender());

        fee = _fee;
    }

    function _bumpAssetNonce(
        address _contractAddress,
        uint256 _tokenId,
        address _signer
    ) internal {
        uint256 previous = _getAssetNonce(_contractAddress, _tokenId, _signer);
        assetNonce[_contractAddress][_tokenId][_signer]++;

        emit AssetNonceUpdated(previous, _getAssetNonce(_contractAddress, _tokenId, _signer), _contractAddress, _tokenId, _signer, _msgSender());
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

        uint256 i = _tenant.index;

        require(_lessor.pricePerDay.length == _lessor.maxDays.length, "Rentals#_verify: INVALID_MAX_DAYS_LENGTH");
        require(_lessor.pricePerDay.length == _lessor.minDays.length, "Rentals#_verify: INVALID_MIN_DAYS_LENGTH");
        require(_tenant.index < _lessor.pricePerDay.length, "Rentals#_verify: INVALID_INDEX");
        require(_lessor.expiration > block.timestamp, "Rentals#_verify: EXPIRED_LESSOR_SIGNATURE");
        require(_tenant.expiration > block.timestamp, "Rentals#_verify: EXPIRED_TENANT_SIGNATURE");
        require(_lessor.minDays[i] <= _lessor.maxDays[i], "Rentals#_verify: MAX_DAYS_LOWER_THAN_MIN_DAYS");
        require(_lessor.minDays[i] > 0, "Rentals#_verify: MIN_DAYS_0");
        require(_tenant.rentalDays >= _lessor.minDays[i] && _tenant.rentalDays <= _lessor.maxDays[i], "Rentals#_verify: DAYS_NOT_IN_RANGE");
        require(_lessor.pricePerDay[i] == _tenant.pricePerDay, "Rentals#_verify: DIFFERENT_PRICE_PER_DAY");
        require(_lessor.contractAddress == _tenant.contractAddress, "Rentals#_verify: DIFFERENT_CONTRACT_ADDRESS");
        require(_lessor.tokenId == _tenant.tokenId, "Rentals#_verify: DIFFERENT_TOKEN_ID");
        require(keccak256(_lessor.fingerprint) == keccak256(_tenant.fingerprint), "Rentals#_verify: DIFFERENT_FINGERPRINT");
        require(_lessor.nonces[0] == contractNonce, "Rentals#_verify: INVALID_LESSOR_CONTRACT_NONCE");
        require(_tenant.nonces[0] == contractNonce, "Rentals#_verify: INVALID_TENANT_CONTRACT_NONCE");
        require(_lessor.nonces[1] == signerNonce[_lessor.signer], "Rentals#_verify: INVALID_LESSOR_SIGNER_NONCE");
        require(_tenant.nonces[1] == signerNonce[_tenant.signer], "Rentals#_verify: INVALID_TENANT_SIGNER_NONCE");

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
                    _lessor.expiration,
                    keccak256(abi.encodePacked(_lessor.nonces)),
                    keccak256(abi.encodePacked(_lessor.pricePerDay)),
                    keccak256(abi.encodePacked(_lessor.maxDays)),
                    keccak256(abi.encodePacked(_lessor.minDays))
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
                    _tenant.expiration,
                    keccak256(abi.encodePacked(_tenant.nonces)),
                    _tenant.pricePerDay,
                    _tenant.rentalDays,
                    _tenant.operator,
                    _tenant.index
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

        require(_lessor.nonces[2] == lessorAssetNonce, "Rentals#_verifyAssetNonces: INVALID_LESSOR_ASSET_NONCE");
        require(_tenant.nonces[2] == tenantAssetNonce, "Rentals#_verifyAssetNonces: INVALID_TENANT_ASSET_NONCE");
    }
}
