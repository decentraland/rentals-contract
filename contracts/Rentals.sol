// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "@dcl/common-contracts/meta-transactions/NativeMetaTransaction.sol";
import "@dcl/common-contracts/signatures/NonceVerifiable.sol";

import "./interfaces/IERC721Rentable.sol";

contract Rentals is NonceVerifiable, NativeMetaTransaction, IERC721Receiver {
    /// @dev EIP712 type hashes for recovering the signer from a signature.
    bytes32 private constant LISTING_TYPE_HASH =
        keccak256(
            bytes(
                "Listing(address signer,address contractAddress,uint256 tokenId,uint256 expiration,uint256[3] nonces,uint256[] pricePerDay,uint256[] maxDays,uint256[] minDays)"
            )
        );

    bytes32 private constant OFFER_TYPE_HASH =
        keccak256(
            bytes(
                "Offer(address signer,address contractAddress,uint256 tokenId,uint256 expiration,uint256[3] nonces,uint256 pricePerDay,uint256 rentalDays,address operator,bytes32 fingerprint)"
            )
        );

    /// @dev EIP165 hash used to detect if a contract supports the verifyFingerprint(uint256,bytes) function.
    bytes4 private constant InterfaceId_VerifyFingerprint = bytes4(keccak256("verifyFingerprint(uint256,bytes)"));

    /// @dev EIP165 hash used to detect if a contract supports the onERC721Received(address,address,uint256,bytes) function.
    bytes4 private constant InterfaceId_OnERC721Received = bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"));

    /// @notice ERC20 token used to pay for rent and fees.
    IERC20 public token;

    /// @notice Tracks necessary rental data per asset.
    /// @custom:schema (contract address -> token id -> lessor address)
    mapping(address => mapping(uint256 => Rental)) public rentals;

    /// @notice Address that will receive ERC20 tokens collected as rental fees.
    address public feeCollector;

    /// @notice Value per million wei that will be deducted from the rental price and sent to the collector.
    uint256 public fee;

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

    event TokenUpdated(IERC20 _from, IERC20 _to, address _sender);
    event FeeCollectorUpdated(address _from, address _to, address _sender);
    event FeeUpdated(uint256 _from, uint256 _to, address _sender);
    event AssetClaimed(address _contractAddress, uint256 _tokenId, address _sender);
    event OperatorUpdated(address _contractAddress, uint256 _tokenId, address _to, address _sender);
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

    /// @notice Initialize the contract.
    /// @dev This method should be called as soon as the contract is deployed.
    /// Using this method in favor of a constructor allows the implementation of various kinds of proxies.
    /// @param _owner The address of the owner of the contract.
    /// @param _token The address of the ERC20 token used by tenants to pay rent.
    /// @param _feeCollector Address that will receive rental fees
    /// @param _fee Value per million wei that will be transfered from the rental price to the fee collector.
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

    /// @notice Set the ERC20 token used by tenants to pay rent.
    /// @param _token The address of the token
    function setToken(IERC20 _token) external onlyOwner {
        _setToken(_token);
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

    /// @notice Get if and asset is currently being rented.
    /// @param _contractAddress The contract address of the asset.
    /// @param _tokenId The token id of the asset.
    /// @return result true or false depending if the asset is currently rented
    function isRented(address _contractAddress, uint256 _tokenId) public view returns (bool result) {
        result = block.timestamp <= rentals[_contractAddress][_tokenId].endDate;
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
    ) external {
        _verifyUnsafeTransfer(_listing.contractAddress, _listing.tokenId);

        // Verify that the signer provided in the listing is the one that signed it.
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
                    keccak256(abi.encodePacked(_listing.minDays))
                )
            )
        );

        address lessor = ECDSAUpgradeable.recover(listingHash, _listing.signature);

        require(lessor == _listing.signer, "Rentals#acceptListing: SIGNATURE_MISSMATCH");

        // Verify that the caller and the signer are not the same address.
        address tenant = _msgSender();

        require(tenant != lessor, "Rentals#acceptListing: CALLER_CANNOT_BE_SIGNER");

        // Verify that the nonces provided in the listing match the ones in the contract.
        _verifyContractNonce(_listing.nonces[0]);
        _verifySignerNonce(lessor, _listing.nonces[1]);
        _verifyAssetNonce(_listing.contractAddress, _listing.tokenId, lessor, _listing.nonces[2]);

        // Verify that pricePerDay, maxDays and minDays have the same length
        require(_listing.pricePerDay.length == _listing.maxDays.length, "Rentals#acceptListing: MAX_DAYS_LENGTH_MISSMATCH");
        require(_listing.pricePerDay.length == _listing.minDays.length, "Rentals#acceptListing: MIN_DAYS_LENGTH_MISSMATCH");

        // Verify that the provided index is not out of bounds of the listing conditions.
        require(_index < _listing.pricePerDay.length, "Rentals#acceptListing: INDEX_OUT_OF_BOUNDS");

        // Verify that the listing is not already expired.
        require(_listing.expiration > block.timestamp, "Rentals#acceptListing: EXPIRED_SIGNATURE");

        // Verify that minDays and maxDays have valid values.
        require(_listing.minDays[_index] <= _listing.maxDays[_index], "Rentals#acceptListing: MAX_DAYS_LOWER_THAN_MIN_DAYS");
        require(_listing.minDays[_index] > 0, "Rentals#acceptListing: MIN_DAYS_IS_ZERO");

        // Verify that the provided rental days is between min and max days range.
        require(_rentalDays >= _listing.minDays[_index] && _rentalDays <= _listing.maxDays[_index], "Rentals#acceptListing: DAYS_NOT_IN_RANGE");

        _rent(lessor, tenant, _listing.contractAddress, _listing.tokenId, _fingerprint, _listing.pricePerDay[_index], _rentalDays, _operator);
    }

    /// @notice Accept an offer for rent of an asset owned by the caller.
    /// @param _offer Contains the offer conditions as well as the signature data for verification.
    function acceptOffer(Offer calldata _offer) external {
        _verifyUnsafeTransfer(_offer.contractAddress, _offer.tokenId);

        _acceptOffer(_offer, _msgSender());
    }

    /// @notice The original owner of the asset can claim it back if said asset is not being rented.
    /// @param _contractAddress The contract address of the asset.
    /// @param _tokenId The token id of the asset.
    function claim(address _contractAddress, uint256 _tokenId) external {
        address sender = _msgSender();

        // Verify that the rent has finished.
        require(!isRented(_contractAddress, _tokenId), "Rentals#claim: CURRENTLY_RENTED");

        Rental memory rental = rentals[_contractAddress][_tokenId];

        // Verify that the caller is the original owner of the asset.
        require(rental.lessor == sender, "Rentals#claim: NOT_LESSOR");

        // Remove the lessor and tenant addresses from the mappings as they don't need more tracking.
        delete rentals[_contractAddress][_tokenId];

        // Transfer the asset back to its original owner.
        IERC721 asset = IERC721(_contractAddress);

        asset.safeTransferFrom(address(this), sender, _tokenId);

        emit AssetClaimed(_contractAddress, _tokenId, sender);
    }

    /// @notice Set the operator of a given asset.
    /// @dev Only when the rent is active a tenant can change the operator of an asset.
    /// When the rent is over, the lessor is the one that can change the operator.
    /// In the case of the lessor, this is useful to update the operator without having to claim the asset back once the rent is over.
    /// @param _contractAddress The contract address of the asset.
    /// @param _tokenId The token id of the asset.
    /// @param _operator The address that will have operator privileges over the asset.
    function setOperator(
        address _contractAddress,
        uint256 _tokenId,
        address _operator
    ) external {
        IERC721Rentable asset = IERC721Rentable(_contractAddress);

        address sender = _msgSender();

        Rental memory rental = rentals[_contractAddress][_tokenId];

        bool rented = isRented(_contractAddress, _tokenId);
        // If rented, only the tenant can change the operator.
        // If not, only the original owner can.
        bool canSetOperator = (rental.tenant == sender && rented) || (rental.lessor == sender && !rented);

        require(canSetOperator, "Rentals#setOperator: CANNOT_UPDATE_OPERATOR");

        // Update the operator.
        asset.setUpdateOperator(_tokenId, _operator);

        emit OperatorUpdated(_contractAddress, _tokenId, _operator, sender);
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
            require(msg.sender == offer.contractAddress, "Rentals#onERC721Received: SENDER_CONTRACT_ADDRESS_MISMATCH");

            // Prevents the holder from sending another token than the one defined in the offer.
            require(offer.tokenId == _tokenId, "Rentals#onERC721Received: TOKEN_ID_MISMATCH");

            _acceptOffer(offer, _operator);
        }

        return InterfaceId_OnERC721Received;
    }

    /// @dev Overriding to return NativeMetaTransaction._getMsgSender for the contract to support meta transactions.
    function _msgSender() internal view override returns (address sender) {
        return _getMsgSender();
    }

    function _setToken(IERC20 _token) private {
        emit TokenUpdated(token, token = _token, _msgSender());
    }

    function _setFeeCollector(address _feeCollector) private {
        emit FeeCollectorUpdated(feeCollector, feeCollector = _feeCollector, _msgSender());
    }

    function _setFee(uint256 _fee) private {
        require(_fee <= 1_000_000, "Rentals#_setFee: HIGHER_THAN_1000000");

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

    function _acceptOffer(Offer memory _offer, address _lessor) private {
        // Verify that the signer provided in the offer is the one that signed it.
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

        address tenant = ECDSAUpgradeable.recover(offerHash, _offer.signature);

        require(tenant == _offer.signer, "Rentals#acceptOffer: SIGNATURE_MISSMATCH");

        require(_lessor != tenant, "Rentals#acceptOffer: CALLER_CANNOT_BE_SIGNER");

        // Verify that the nonces provided in the offer match the ones in the contract.
        _verifyContractNonce(_offer.nonces[0]);
        _verifySignerNonce(tenant, _offer.nonces[1]);
        _verifyAssetNonce(_offer.contractAddress, _offer.tokenId, tenant, _offer.nonces[2]);

        // Verify that the offer is not already expired.
        require(_offer.expiration > block.timestamp, "Rentals#acceptOffer: EXPIRED_SIGNATURE");

        // Verify that the rental days provided in the offer are valid.
        require(_offer.rentalDays > 0, "Rentals#acceptOffer: RENTAL_DAYS_IS_ZERO");

        _rent(_lessor, tenant, _offer.contractAddress, _offer.tokenId, _offer.fingerprint, _offer.pricePerDay, _offer.rentalDays, _offer.operator);
    }

    function _rent(
        address _lessor,
        address _tenant,
        address _contractAddress,
        uint256 _tokenId,
        bytes32 _fingerprint,
        uint256 _pricePerDay,
        uint256 _rentalDays,
        address _operator
    ) private {
        // Verify that the asset is not already rented.
        require(!isRented(_contractAddress, _tokenId), "Rentals#_rent: CURRENTLY_RENTED");

        IERC721Rentable asset = IERC721Rentable(_contractAddress);

        // If the provided contract support the verifyFingerpint function, validate the provided fingerprint.
        if (_supportsVerifyFingerprint(asset)) {
            require(_verifyFingerprint(asset, _tokenId, _fingerprint), "Rentals#_rent: INVALID_FINGERPRINT");
        }

        Rental storage rental = rentals[_contractAddress][_tokenId];

        if (rental.lessor != address(0)) {
            // The contract already has the asset, so we just need to validate that the original owner matches the provided lessor.
            require(rental.lessor == _lessor, "Rentals#_rent: NOT_ORIGINAL_OWNER");
        } else {
            // Track the original owner of the asset in the lessors map for future use.
            rental.lessor = _lessor;
        }

        // Set the rental finish timestamp in the rentals mapping.
        rental.endDate = block.timestamp + _rentalDays * 86400; // 86400 = seconds in a day

        // Track the new tenant in the mapping.
        rental.tenant = _tenant;

        // Update the asset nonces for both the lessor and the tenant to invalidate old signatures.
        _bumpAssetNonce(_contractAddress, _tokenId, _lessor);
        _bumpAssetNonce(_contractAddress, _tokenId, _tenant);

        // Transfer tokens
        if (_pricePerDay > 0) {
            _handleTokenTransfers(_lessor, _tenant, _pricePerDay, _rentalDays);
        }

        // Only transfer the ERC721 to this contract if it doesn't already have it.
        if (_ownerOf(address(asset), _tokenId) != address(this)) {
            asset.safeTransferFrom(_lessor, address(this), _tokenId);
        }

        // Update the operator
        asset.setUpdateOperator(_tokenId, _operator);

        emit RentalStarted(_contractAddress, _tokenId, _lessor, _tenant, _operator, _rentalDays, _pricePerDay, _msgSender());
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
        uint256 forCollector = (totalPrice * fee) / 1_000_000;

        // Transfer the rental payment to the lessor minus the fee which is transfered to the collector.
        token.transferFrom(_tenant, _lessor, totalPrice - forCollector);
        token.transferFrom(_tenant, feeCollector, forCollector);
    }
}
