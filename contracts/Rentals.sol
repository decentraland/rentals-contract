// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "@dcl/common-contracts/meta-transactions/NativeMetaTransaction.sol";
import "@dcl/common-contracts/signatures/ContractNonceVerifiable.sol";
import "@dcl/common-contracts/signatures/SignerNonceVerifiable.sol";
import "@dcl/common-contracts/signatures/AssetNonceVerifiable.sol";

import "./interfaces/IERC721Rentable.sol";

contract Rentals is
    ContractNonceVerifiable,
    SignerNonceVerifiable,
    AssetNonceVerifiable,
    NativeMetaTransaction,
    IERC721Receiver,
    ReentrancyGuardUpgradeable
{
    /// @dev EIP712 type hashes for recovering the signer from a signature.
    bytes32 private constant LISTING_TYPE_HASH =
        keccak256(
            bytes(
                "Listing(address signer,address contractAddress,uint256 tokenId,uint256 expiration,uint256[3] nonces,uint256[] pricePerDay,uint256[] maxDays,uint256[] minDays,address target)"
            )
        );

    bytes32 private constant OFFER_TYPE_HASH =
        keccak256(
            bytes(
                "Offer(address signer,address contractAddress,uint256 tokenId,uint256 expiration,uint256[3] nonces,uint256 pricePerDay,uint256 rentalDays,address operator,bytes32 fingerprint)"
            )
        );

    uint256 private constant MAX_FEE = 1_000_000;
    uint256 private constant MAX_RENTAL_DAYS = 36525; // 100 years

    /// @dev EIP165 hash used to detect if a contract supports the verifyFingerprint(uint256,bytes) function.
    bytes4 private constant InterfaceId_VerifyFingerprint = bytes4(keccak256("verifyFingerprint(uint256,bytes)"));

    /// @dev EIP165 hash used to detect if a contract supports the onERC721Received(address,address,uint256,bytes) function.
    bytes4 private constant InterfaceId_OnERC721Received = bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"));

    /// @notice ERC20 token used to pay for rent and fees.
    IERC20 private token;

    /// @notice Tracks necessary rental data per asset.
    /// @custom:schema (contract address -> token id -> lessor address)
    mapping(address => mapping(uint256 => Rental)) private rentals;

    /// @notice Address that will receive ERC20 tokens collected as rental fees.
    address private feeCollector;

    /// @notice Value per million wei that will be deducted from the rental price and sent to the collector.
    uint256 private fee;

    /// @notice Struct received as a parameter in `acceptListing` containing all information about
    /// listing conditions and values required to verify the signature was created by the signer.
    struct Listing {
        address signer;
        address contractAddress;
        uint256 tokenId;
        uint256 expiration;
        uint256[3] nonces;
        uint256[] pricePerDay;
        uint256[] maxDays;
        uint256[] minDays;
        // Makes the listing acceptable only by the address defined as target.
        // Using address(0) as target will allow any address to accept it.
        address target;
        bytes signature;
    }

    /// @notice Struct received as a parameter in `acceptOffer` containing all information about
    /// offer conditions and values required to verify the signature was created by the signer.
    struct Offer {
        address signer;
        address contractAddress;
        uint256 tokenId;
        uint256 expiration;
        uint256[3] nonces;
        uint256 pricePerDay;
        uint256 rentalDays;
        address operator;
        bytes32 fingerprint;
        bytes signature;
    }

    struct Rental {
        address lessor;
        address tenant;
        uint256 endDate;
    }

    struct RentParams {
        address lessor;
        address tenant;
        address contractAddress;
        uint256 tokenId;
        bytes32 fingerprint;
        uint256 pricePerDay;
        uint256 rentalDays;
        address operator;
        bytes signature;
    }

    event FeeCollectorUpdated(address _from, address _to, address _sender);
    event FeeUpdated(uint256 _from, uint256 _to, address _sender);
    event AssetClaimed(address indexed _contractAddress, uint256 indexed _tokenId, address _sender);
    event AssetRented(
        address indexed _contractAddress,
        uint256 indexed _tokenId,
        address _lessor,
        address _tenant,
        address _operator,
        uint256 _rentalDays,
        uint256 _pricePerDay,
        bool _isExtension,
        address _sender,
        bytes _signature
    );

    /// @notice Initialize the contract.
    /// @dev This method should be called as soon as the contract is deployed.
    /// Using this method in favor of a constructor allows the implementation of various kinds of proxies.
    /// @param _owner The address of the owner of the contract.
    /// @param _token The address of the ERC20 token used by tenants to pay rent.
    /// @param _feeCollector Address that will receive rental fees
    /// @param _fee Value per million wei that will be transferred from the rental price to the fee collector.
    function initialize(
        address _owner,
        IERC20 _token,
        address _feeCollector,
        uint256 _fee
    ) external initializer {
        __ReentrancyGuard_init();
        __NativeMetaTransaction_init("Rentals", "1");
        __ContractNonceVerifiable_init();
        _transferOwnership(_owner);
        _setFeeCollector(_feeCollector);
        _setFee(_fee);

        token = _token;
    }

    /// @notice Get the rental data for a given asset.
    /// @param _contractAddress The contract address of the asset.
    /// @param _tokenId The id of the asset.
    function getRental(address _contractAddress, uint256 _tokenId) external view returns (Rental memory) {
        return rentals[_contractAddress][_tokenId];
    }

    /// @notice Get the current token address used for rental payments.
    function getToken() external view returns (IERC20) {
        return token;
    }

    /// @notice Get the current address that will receive a cut of rental payments as a fee.
    function getFeeCollector() external view returns (address) {
        return feeCollector;
    }

    /// @notice Get the value per MAX_FEE that will be cut from the rental payment and sent to the fee collector.
    function getFee() external view returns (uint256) {
        return fee;
    }

    /// @notice Get if and asset is currently being rented.
    /// @param _contractAddress The contract address of the asset.
    /// @param _tokenId The token id of the asset.
    /// @return result true or false depending if the asset is currently rented
    function getIsRented(address _contractAddress, uint256 _tokenId) public view returns (bool result) {
        result = block.timestamp <= rentals[_contractAddress][_tokenId].endDate;
    }

    /// @notice Set the address of the fee collector.
    /// @param _feeCollector The address of the fee collector.
    function setFeeCollector(address _feeCollector) external onlyOwner {
        _setFeeCollector(_feeCollector);
    }

    /// @notice Set the fee (per million wei) for rentals.
    /// @param _fee The value for the fee.
    function setFee(uint256 _fee) external onlyOwner {
        _setFee(_fee);
    }

    /// @notice Accept a rental listing created by the owner of an asset.
    /// @param _listing Contains the listing conditions as well as the signature data for verification.
    /// @param _operator The address that will be given operator permissions over an asset.
    /// @param _index The rental conditions index chosen from the options provided in _listing.
    /// @param _rentalDays The amount of days the caller wants to rent the asset.
    /// Must be a value between the selected condition's min and max days.
    /// @param _fingerprint The fingerprint used to verify composable erc721s.
    /// Useful in order to prevent a front run were, for example, the owner removes LAND from and Estate before
    /// the listing is accepted. Causing the tenant to end up with an Estate that does not have the amount of LAND
    /// they expected.
    function acceptListing(
        Listing calldata _listing,
        address _operator,
        uint256 _index,
        uint256 _rentalDays,
        bytes32 _fingerprint
    ) external nonReentrant {
        _verifyUnsafeTransfer(_listing.contractAddress, _listing.tokenId);

        address lessor = _listing.signer;

        // Verify that the caller and the signer are not the same address.
        address tenant = _msgSender();

        require(tenant != lessor, "Rentals#acceptListing: CALLER_CANNOT_BE_SIGNER");

        // Verify that the targeted address in the listing is the caller of this function.
        require(_listing.target == address(0) || _listing.target == tenant, "Rentals#acceptListing: TARGET_MISMATCH");

        // Verify that the nonces provided in the listing match the ones in the contract.
        _verifyContractNonce(_listing.nonces[0]);
        _verifySignerNonce(lessor, _listing.nonces[1]);
        _verifyAssetNonce(_listing.contractAddress, _listing.tokenId, lessor, _listing.nonces[2]);

        uint256 pricePerDayLength = _listing.pricePerDay.length;

        // Verify that pricePerDay, maxDays and minDays have the same length
        require(pricePerDayLength == _listing.maxDays.length, "Rentals#acceptListing: MAX_DAYS_LENGTH_MISMATCH");
        require(pricePerDayLength == _listing.minDays.length, "Rentals#acceptListing: MIN_DAYS_LENGTH_MISMATCH");

        // Verify that the provided index is not out of bounds of the listing conditions.
        require(_index < pricePerDayLength, "Rentals#acceptListing: INDEX_OUT_OF_BOUNDS");

        // Verify that the listing is not already expired.
        require(_listing.expiration >= block.timestamp, "Rentals#acceptListing: EXPIRED_SIGNATURE");

        uint256 maxDays = _listing.maxDays[_index];
        uint256 minDays = _listing.minDays[_index];

        // Verify that minDays and maxDays have valid values.
        require(minDays <= maxDays, "Rentals#acceptListing: MAX_DAYS_LOWER_THAN_MIN_DAYS");
        require(minDays > 0, "Rentals#acceptListing: MIN_DAYS_IS_ZERO");

        // Verify that the provided rental days is between min and max days range.
        require(_rentalDays >= minDays && _rentalDays <= maxDays, "Rentals#acceptListing: DAYS_NOT_IN_RANGE");

        // Verify that the provided rental days does not exceed MAX_RENTAL_DAYS
        require(_rentalDays <= MAX_RENTAL_DAYS, "Rentals#acceptListing: RENTAL_DAYS_EXCEEDES_LIMIT");

        _verifyListingSigner(_listing);

        _rent(
            RentParams(
                lessor,
                tenant,
                _listing.contractAddress,
                _listing.tokenId,
                _fingerprint,
                _listing.pricePerDay[_index],
                _rentalDays,
                _operator,
                _listing.signature
            )
        );
    }

    /// @notice Accept an offer for rent of an asset owned by the caller.
    /// @param _offer Contains the offer conditions as well as the signature data for verification.
    function acceptOffer(Offer calldata _offer) external {
        _verifyUnsafeTransfer(_offer.contractAddress, _offer.tokenId);

        _acceptOffer(_offer, _msgSender());
    }

    /// @notice The original owner of the asset can claim it back if said asset is not being rented.
    /// @param _contractAddresses The contract address of the assets to be claimed.
    /// @param _tokenIds The token ids of the assets to be claimed.
    /// Each tokenId corresponds to a contract address in the same index.
    function claim(address[] memory _contractAddresses, uint256[] memory _tokenIds) external nonReentrant {
        address sender = _msgSender();

        require(_contractAddresses.length == _tokenIds.length, "Rentals#claim: LENGTH_MISMATCH");

        for (uint256 i = 0; i < _contractAddresses.length; i++) {
            address contractAddress = _contractAddresses[i];
            uint256 tokenId = _tokenIds[i];

            // Verify that the rent has finished.
            require(!getIsRented(contractAddress, tokenId), "Rentals#claim: CURRENTLY_RENTED");

            Rental memory rental = rentals[contractAddress][tokenId];

            // Verify that the caller is the original owner of the asset.
            require(rental.lessor == sender, "Rentals#claim: NOT_LESSOR");

            // Remove the lessor and tenant addresses from the mappings as they don't need more tracking.
            delete rentals[contractAddress][tokenId];

            // Transfer the asset back to its original owner.
            IERC721 asset = IERC721(contractAddress);

            asset.safeTransferFrom(address(this), sender, tokenId);

            emit AssetClaimed(contractAddress, tokenId, sender);
        }
    }

    /// @notice Set the update operator of the provided assets.
    /// @dev Only when the rent is active a tenant can change the operator of an asset.
    /// When the rent is over, the lessor is the one that can change the operator.
    /// In the case of the lessor, this is useful to update the operator without having to claim the asset back once the rent is over.
    /// Elements in the param arrays correspond to each other in the same index.
    /// For example, asset with address _contractAddresses[0] and token id _tokenIds[0] will be set _operators[0] as operator.
    /// @param _contractAddresses The contract addresses of the assets.
    /// @param _tokenIds The token ids of the assets.
    /// @param _operators The addresses that will have operator privileges over the given assets.
    function setUpdateOperator(
        address[] memory _contractAddresses,
        uint256[] memory _tokenIds,
        address[] memory _operators
    ) external nonReentrant {
        require(
            _contractAddresses.length == _tokenIds.length && _contractAddresses.length == _operators.length,
            "Rentals#setUpdateOperator: LENGTH_MISMATCH"
        );

        address sender = _msgSender();

        for (uint256 i = 0; i < _tokenIds.length; i++) {
            address contractAddress = _contractAddresses[i];
            uint256 tokenId = _tokenIds[i];
            Rental memory rental = rentals[contractAddress][tokenId];
            bool isRented = getIsRented(contractAddress, tokenId);

            require(
                (isRented && sender == rental.tenant) || (!isRented && sender == rental.lessor),
                "Rentals#setUpdateOperator: CANNOT_SET_UPDATE_OPERATOR"
            );

            IERC721Rentable(contractAddress).setUpdateOperator(tokenId, _operators[i]);
        }
    }

    /// @notice Set the operator of LANDs inside an Estate
    /// @dev Differently from the update operator role of the estate, when the asset is transferred to the rentals contract,
    /// LAND update operators can be set to assign granular permissions. LAND update operators will remain if they are inside an Estate when it is transferred.
    /// They are only cleared once the LAND is transferred.
    /// @param _contractAddress The address of the Estate contract containing the LANDs that will have their update operators updated.
    /// @param _tokenId The Estate id.
    /// @param _landTokenIds An array of LAND token id arrays. Each array corresponds to the operator of the same index.
    /// @param _operators An array of addresses that will be set as update operators of the provided LAND token ids.
    function setManyLandUpdateOperator(
        address _contractAddress,
        uint256 _tokenId,
        uint256[][] memory _landTokenIds,
        address[] memory _operators
    ) external nonReentrant {
        require(_landTokenIds.length == _operators.length, "Rentals#setManyLandUpdateOperator: LENGTH_MISMATCH");

        Rental memory rental = rentals[_contractAddress][_tokenId];
        bool isRented = getIsRented(_contractAddress, _tokenId);
        address sender = _msgSender();

        require(
            (isRented && sender == rental.tenant) || (!isRented && sender == rental.lessor),
            "Rentals#setManyLandUpdateOperator: CANNOT_SET_MANY_LAND_UPDATE_OPERATOR"
        );

        for (uint256 i = 0; i < _landTokenIds.length; i++) {
            IERC721Rentable(_contractAddress).setManyLandUpdateOperator(_tokenId, _landTokenIds[i], _operators[i]);
        }
    }

    /// @notice Standard function called by ERC721 contracts whenever a safe transfer occurs.
    /// Provides an alternative to acceptOffer by letting the asset holder send the asset to the contract
    /// and accepting the offer at the same time.
    /// IMPORTANT: Addresses that have been given allowance to an asset can safely transfer said asset to this contract
    /// to accept an offer. The address that has been given allowance will be considered the lessor, and will enjoy all of its benefits,
    /// including the ability to claim the asset back to themselves after the rental period is over.
    /// @param _operator Caller of the safeTransfer function.
    /// @param _tokenId Id of the asset received.
    /// @param _data Bytes containing offer data.
    function onERC721Received(
        address _operator,
        address, // _from,
        uint256 _tokenId,
        bytes memory _data
    ) external override returns (bytes4) {
        if (_operator != address(this)) {
            Offer memory offer = abi.decode(_data, (Offer));

            // Check that the caller is the contract defined in the offer to ensure the function is being
            // called through an ERC721.safeTransferFrom.
            // Also check that the token id is the same as the one provided in the offer.
            require(msg.sender == offer.contractAddress && offer.tokenId == _tokenId, "Rentals#onERC721Received: ASSET_MISMATCH");

            _acceptOffer(offer, _operator);
        }

        return InterfaceId_OnERC721Received;
    }

    /// @dev Overriding to return NativeMetaTransaction._getMsgSender for the contract to support meta transactions.
    function _msgSender() internal view override returns (address sender) {
        return _getMsgSender();
    }

    function _setFeeCollector(address _feeCollector) private {
        emit FeeCollectorUpdated(feeCollector, feeCollector = _feeCollector, _msgSender());
    }

    function _setFee(uint256 _fee) private {
        require(_fee <= MAX_FEE, "Rentals#_setFee: HIGHER_THAN_MAX_FEE");

        emit FeeUpdated(fee, fee = _fee, _msgSender());
    }

    /// @dev Reverts if someone is trying to rent an asset that was unsafely sent to the rentals contract.
    function _verifyUnsafeTransfer(address _contractAddress, uint256 _tokenId) private view {
        address lessor = rentals[_contractAddress][_tokenId].lessor;
        address assetOwner = _ownerOf(_contractAddress, _tokenId);

        if (lessor == address(0) && assetOwner == address(this)) {
            revert("Rentals#_verifyUnsafeTransfer: ASSET_TRANSFERRED_UNSAFELY");
        }
    }

    function _acceptOffer(Offer memory _offer, address _lessor) private nonReentrant {
        address tenant = _offer.signer;

        require(_lessor != tenant, "Rentals#_acceptOffer: CALLER_CANNOT_BE_SIGNER");

        // Verify that the nonces provided in the offer match the ones in the contract.
        _verifyContractNonce(_offer.nonces[0]);
        _verifySignerNonce(tenant, _offer.nonces[1]);
        _verifyAssetNonce(_offer.contractAddress, _offer.tokenId, tenant, _offer.nonces[2]);

        // Verify that the offer is not already expired.
        require(_offer.expiration >= block.timestamp, "Rentals#_acceptOffer: EXPIRED_SIGNATURE");

        // Verify that the rental days provided in the offer are valid.
        require(_offer.rentalDays > 0, "Rentals#_acceptOffer: RENTAL_DAYS_IS_ZERO");

        // Verify that the provided rental days does not exceed MAX_RENTAL_DAYS
        require(_offer.rentalDays <= MAX_RENTAL_DAYS, "Rentals#_acceptOffer: RENTAL_DAYS_EXCEEDES_LIMIT");

        _verifyOfferSigner(_offer);

        _rent(
            RentParams(
                _lessor,
                tenant,
                _offer.contractAddress,
                _offer.tokenId,
                _offer.fingerprint,
                _offer.pricePerDay,
                _offer.rentalDays,
                _offer.operator,
                _offer.signature
            )
        );
    }

    /// @dev Verify that the signer provided in the listing is the address that created the provided signature.
    function _verifyListingSigner(Listing calldata _listing) private view {
        bytes32 listingHash = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    LISTING_TYPE_HASH,
                    _listing.signer,
                    _listing.contractAddress,
                    _listing.tokenId,
                    _listing.expiration,
                    keccak256(abi.encodePacked(_listing.nonces)),
                    keccak256(abi.encodePacked(_listing.pricePerDay)),
                    keccak256(abi.encodePacked(_listing.maxDays)),
                    keccak256(abi.encodePacked(_listing.minDays)),
                    _listing.target
                )
            )
        );

        address signer = ECDSAUpgradeable.recover(listingHash, _listing.signature);

        require(signer == _listing.signer, "Rentals#_verifyListingSigner: SIGNER_MISMATCH");
    }

    /// @dev Verify that the signer provided in the offer is the address that created the provided signature.
    function _verifyOfferSigner(Offer memory _offer) private view {
        bytes32 offerHash = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    OFFER_TYPE_HASH,
                    _offer.signer,
                    _offer.contractAddress,
                    _offer.tokenId,
                    _offer.expiration,
                    keccak256(abi.encodePacked(_offer.nonces)),
                    _offer.pricePerDay,
                    _offer.rentalDays,
                    _offer.operator,
                    _offer.fingerprint
                )
            )
        );

        address signer = ECDSAUpgradeable.recover(offerHash, _offer.signature);

        require(signer == _offer.signer, "Rentals#_verifyOfferSigner: SIGNER_MISMATCH");
    }

    function _rent(RentParams memory _rentParams) private {
        IERC721Rentable asset = IERC721Rentable(_rentParams.contractAddress);

        // If the provided contract support the verifyFingerprint function, validate the provided fingerprint.
        if (_supportsVerifyFingerprint(asset)) {
            require(_verifyFingerprint(asset, _rentParams.tokenId, _rentParams.fingerprint), "Rentals#_rent: INVALID_FINGERPRINT");
        }

        Rental storage rental = rentals[_rentParams.contractAddress][_rentParams.tokenId];

        // True if the asset is currently rented.
        bool isRented = getIsRented(_rentParams.contractAddress, _rentParams.tokenId);
        // True if the asset rental period is over, but is has not been claimed back from the contract.
        bool isReRent = !isRented && rental.lessor != address(0);
        // True if the asset rental period is not over yet, but the lessor and the tenant are the same.
        bool isExtend = isRented && rental.lessor == _rentParams.lessor && rental.tenant == _rentParams.tenant;

        if (!isExtend && !isReRent) {
            // Verify that the asset is not already rented.
            require(!isRented, "Rentals#_rent: CURRENTLY_RENTED");
        }

        if (isReRent) {
            // The asset is being rented again wihout claiming it back first, so we need to check that the previous lessor
            // is the same as the lessor this time to prevent anyone else from acting as the lessor.
            require(rental.lessor == _rentParams.lessor, "Rentals#_rent: NOT_ORIGINAL_OWNER");
        }

        if (isExtend) {
            // Increase the current end date by the amount of provided rental days.
            rental.endDate = rental.endDate + _rentParams.rentalDays * 1 days;
        } else {
            // Track the original owner of the asset in the lessors map for future use.
            rental.lessor = _rentParams.lessor;

            // Track the new tenant in the mapping.
            rental.tenant = _rentParams.tenant;

            // Set the end date of the rental according to the provided rental days
            rental.endDate = block.timestamp + _rentParams.rentalDays * 1 days;
        }

        // Update the asset nonces for both the lessor and the tenant to invalidate old signatures.
        _bumpAssetNonce(_rentParams.contractAddress, _rentParams.tokenId, _rentParams.lessor);
        _bumpAssetNonce(_rentParams.contractAddress, _rentParams.tokenId, _rentParams.tenant);

        // Transfer tokens
        if (_rentParams.pricePerDay > 0) {
            _handleTokenTransfers(_rentParams.lessor, _rentParams.tenant, _rentParams.pricePerDay, _rentParams.rentalDays);
        }

        // Only transfer the ERC721 to this contract if it doesn't already have it.
        if (_ownerOf(address(asset), _rentParams.tokenId) != address(this)) {
            asset.safeTransferFrom(_rentParams.lessor, address(this), _rentParams.tokenId);
        }

        // Update the operator
        asset.setUpdateOperator(_rentParams.tokenId, _rentParams.operator);

        emit AssetRented(
            _rentParams.contractAddress,
            _rentParams.tokenId,
            _rentParams.lessor,
            _rentParams.tenant,
            _rentParams.operator,
            _rentParams.rentalDays,
            _rentParams.pricePerDay,
            isExtend,
            _msgSender(),
            _rentParams.signature
        );
    }

    /// @dev Wrapper to static call IERC721Rentable.ownerOf
    function _ownerOf(address _contractAddress, uint256 _tokenId) private view returns (address) {
        (bool success, bytes memory data) = _contractAddress.staticcall(
            abi.encodeWithSelector(IERC721Rentable(_contractAddress).ownerOf.selector, _tokenId)
        );

        require(success, "Rentals#_ownerOf: OWNER_OF_CALL_FAILURE");

        return abi.decode(data, (address));
    }

    /// @dev Wrapper to static call IERC721Rentable.supportsInterface
    function _supportsVerifyFingerprint(IERC721Rentable _asset) private view returns (bool) {
        (bool success, bytes memory data) = address(_asset).staticcall(
            abi.encodeWithSelector(_asset.supportsInterface.selector, InterfaceId_VerifyFingerprint)
        );

        require(success, "Rentals#_supportsVerifyFingerprint: SUPPORTS_INTERFACE_CALL_FAILURE");

        return abi.decode(data, (bool));
    }

    /// @dev Wrapper to static call IERC721Rentable.verifyFingerprint
    function _verifyFingerprint(
        IERC721Rentable _asset,
        uint256 _tokenId,
        bytes32 _fingerprint
    ) private view returns (bool) {
        (bool success, bytes memory data) = address(_asset).staticcall(
            abi.encodeWithSelector(_asset.verifyFingerprint.selector, _tokenId, abi.encode(_fingerprint))
        );

        require(success, "Rentals#_verifyFingerprint: VERIFY_FINGERPRINT_CALL_FAILURE");

        return abi.decode(data, (bool));
    }

    /// @dev Transfer the erc20 tokens required to start a rent from the tenant to the lessor and the fee collector.
    function _handleTokenTransfers(
        address _lessor,
        address _tenant,
        uint256 _pricePerDay,
        uint256 _rentalDays
    ) private {
        uint256 totalPrice = _pricePerDay * _rentalDays;
        uint256 forCollector = (totalPrice * fee) / MAX_FEE;

        // Save the reference in memory so it doesn't access storage twice.
        IERC20 mToken = token;

        // Transfer the rental payment to the lessor minus the fee which is transfered to the collector.
        mToken.transferFrom(_tenant, _lessor, totalPrice - forCollector);
        mToken.transferFrom(_tenant, feeCollector, forCollector);
    }
}
