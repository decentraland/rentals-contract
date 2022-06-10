// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./commons/NativeMetaTransaction.sol";
import "./commons/NonceVerifiable.sol";

import "./interfaces/IERC721Operable.sol";
import "./interfaces/IERC721Verifiable.sol";

contract Rentals is NonceVerifiable, NativeMetaTransaction, IERC721Receiver {
    /// @dev EIP712 type hashes for recovering the signer from a signature.
    bytes32 private constant LISTING_TYPE_HASH =
        keccak256(
            bytes(
                "Listing(address signer,address contractAddress,uint256 tokenId,uint256 expiration,uint256[3] nonces,uint256[] pricePerDay,uint256[] maxDays,uint256[] minDays)"
            )
        );

    bytes32 private constant BID_TYPE_HASH =
        keccak256(
            bytes(
                "Bid(address signer,address contractAddress,uint256 tokenId,uint256 expiration,uint256[3] nonces,uint256 pricePerDay,uint256 rentalDays,address operator,bytes32 fingerprint)"
            )
        );

    /// @dev EIP165 hash used to detect if a contract supports the verifyFingerprint(uint256,bytes) function.
    bytes4 private constant InterfaceId_VerifyFingerprint = bytes4(keccak256("verifyFingerprint(uint256,bytes)"));

    /// @dev EIP165 hash used to detect if a contract supports the onERC721Received(address,address,uint256,bytes) function.
    bytes4 private constant InterfaceId_OnERC721Received = bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"));

    /// @notice ERC20 token used to pay for rent and fees.
    IERC20 public token;

    /// @notice Keeps track of the original owners of the assets that have been rented.
    /// @custom:schema (contract address -> token id -> lessor address)
    mapping(address => mapping(uint256 => address)) public lessors;

    /// @notice Keeps track of the addresses acting as tenants of an asset after the initiation of a rental.
    /// @custom:schema (contract address -> token id -> tenant address)
    mapping(address => mapping(uint256 => address)) public tenants;

    /// @notice Keeps track of the timestamp when rentals end.
    /// @custom:schema (contract address -> token id -> finish timestamp)
    mapping(address => mapping(uint256 => uint256)) public rentals;

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

    /// @notice Struct received as a parameter in `acceptBid` containing all information about
    /// bid conditions and values required to verify the signature was created by the signer.
    struct Bid {
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
    /// @return true or false depending if the asset is currently rented
    function isRented(address _contractAddress, uint256 _tokenId) public view returns (bool) {
        return block.timestamp < rentals[_contractAddress][_tokenId];
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

    /// @notice Accept a bid for rent of an asset owned by the caller.
    /// @param _bid Contains the bid conditions as well as the signature data for verification.
    function acceptBid(Bid calldata _bid) external {
        // Verify that the signer provided in the bid is the one that signed it.
        bytes32 bidHash = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    BID_TYPE_HASH,
                    _bid.signer,
                    _bid.contractAddress,
                    _bid.tokenId,
                    _bid.expiration,
                    keccak256(abi.encodePacked(_bid.nonces)),
                    _bid.pricePerDay,
                    _bid.rentalDays,
                    _bid.operator,
                    _bid.fingerprint
                )
            )
        );

        address tenant = ECDSAUpgradeable.recover(bidHash, _bid.signature);

        require(tenant == _bid.signer, "Rentals#acceptBid: SIGNATURE_MISSMATCH");

        // Verify that the caller and the signer are not the same address.
        address lessor = _msgSender();

        require(lessor != tenant, "Rentals#acceptBid: CALLER_CANNOT_BE_SIGNER");

        // Verify that the nonces provided in the bid match the ones in the contract.
        _verifyContractNonce(_bid.nonces[0]);
        _verifySignerNonce(tenant, _bid.nonces[1]);
        _verifyAssetNonce(_bid.contractAddress, _bid.tokenId, tenant, _bid.nonces[2]);

        // Verify that the bid is not already expired.
        require(_bid.expiration > block.timestamp, "Rentals#acceptBid: EXPIRED_SIGNATURE");

        // Verify that the rental days provided in the bid are valid.
        require(_bid.rentalDays > 0, "Rentals#acceptBid: RENTAL_DAYS_IS_ZERO");

        _rent(lessor, tenant, _bid.contractAddress, _bid.tokenId, _bid.fingerprint, _bid.pricePerDay, _bid.rentalDays, _bid.operator);
    }

    /// @notice The original owner of the asset can claim it back if said asset is not being rented.
    /// @param _contractAddress The contract address of the asset.
    /// @param _tokenId The token id of the asset.
    function claim(address _contractAddress, uint256 _tokenId) external {
        address sender = _msgSender();

        // Verify that the rent has finished.
        require(!isRented(_contractAddress, _tokenId), "Rentals#claim: CURRENTLY_RENTED");
        // Verify that the caller is the original owner of the asset.
        require(lessors[_contractAddress][_tokenId] == sender, "Rentals#claim: NOT_LESSOR");

        // Remove the lessor and tenant addresses from the mappings as they don't need more tracking.
        lessors[_contractAddress][_tokenId] = address(0);
        tenants[_contractAddress][_tokenId] = address(0);

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
        IERC721Operable asset = IERC721Operable(_contractAddress);

        address sender = _msgSender();
        address tenant = tenants[_contractAddress][_tokenId];
        address lessor = lessors[_contractAddress][_tokenId];

        bool rented = isRented(_contractAddress, _tokenId);
        // If rented, only the tenant can change the operator.
        // If not, only the original owner can.
        bool canSetOperator = (tenant == sender && rented) || (lessor == sender && !rented);

        require(canSetOperator, "Rentals#setOperator: CANNOT_UPDATE_OPERATOR");

        // Update the operator.
        asset.setUpdateOperator(_tokenId, _operator);

        emit OperatorUpdated(_contractAddress, _tokenId, _operator, sender);
    }

    /// @notice Standard function called by ERC721 contracts whenever a safe transfer occurs.
    /// @dev The contract only allows safe transfers by itself made by the rent function.
    /// @param _operator Caller of the safe transfer function.
    function onERC721Received(
        address _operator,
        address, // _from,
        uint256, // _tokenId,
        bytes calldata // _data
    ) external view override returns (bytes4) {
        require(_operator == address(this), "Rentals#onERC721Received: ONLY_ACCEPT_TRANSFERS_FROM_THIS_CONTRACT");
        return InterfaceId_OnERC721Received;
    }

    /// @dev By overriding this function, _msgSender becomes compatible with meta transactions.
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
        // If the provided contract support the verifyFingerpint function, validate the provided fingerprint.
        IERC721Verifiable verifiable = IERC721Verifiable(_contractAddress);

        if (verifiable.supportsInterface(InterfaceId_VerifyFingerprint)) {
            require(verifiable.verifyFingerprint(_tokenId, abi.encodePacked(_fingerprint)), "Rentals#_rent: INVALID_FINGERPRINT");
        }

        // Verify that the asset is not already rented.
        require(!isRented(_contractAddress, _tokenId), "Rentals#_rent: CURRENTLY_RENTED");

        IERC721Operable asset = IERC721Operable(_contractAddress);

        bool isAssetOwnedByContract = lessors[_contractAddress][_tokenId] != address(0);

        if (isAssetOwnedByContract) {
            // The contract already has the asset, so we just need to validate that the original owner matches the provided lessor.
            require(lessors[_contractAddress][_tokenId] == _lessor, "Rentals#_rent: NOT_ORIGINAL_OWNER");
        } else {
            // Track the original owner of the asset in the lessors map for future use.
            lessors[_contractAddress][_tokenId] = _lessor;
        }

        // Set the rental finish timestamp in the rentals mapping.
        rentals[_contractAddress][_tokenId] = block.timestamp + _rentalDays * 86400; // 86400 = seconds in a day

        // Update the asset nonces for both the lessor and the tenant to invalidate old signatures.
        _bumpAssetNonce(_contractAddress, _tokenId, _lessor);
        _bumpAssetNonce(_contractAddress, _tokenId, _tenant);

        if (_pricePerDay > 0) {
            uint256 totalPrice = _pricePerDay * _rentalDays;
            uint256 forCollector = (totalPrice * fee) / 1_000_000;

            // Transfer the rental payment to the lessor minus the fee which is transfered to the collector.
            token.transferFrom(_tenant, _lessor, totalPrice - forCollector);
            token.transferFrom(_tenant, feeCollector, forCollector);
        }

        // Only transfer the ERC721 to this contract if it doesn't already have it.
        if (!isAssetOwnedByContract) {
            asset.safeTransferFrom(_lessor, address(this), _tokenId);
        }

        // Track the new tenant in the mapping.
        tenants[_contractAddress][_tokenId] = _tenant;

        // Update the operator
        asset.setUpdateOperator(_tokenId, _operator);

        emit RentalStarted(_contractAddress, _tokenId, _lessor, _tenant, _operator, _rentalDays, _pricePerDay, _msgSender());
    }
}
