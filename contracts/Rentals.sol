// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/draft-EIP712Upgradeable.sol";

contract Rentals is OwnableUpgradeable, EIP712Upgradeable {
    // Constants
    bytes32 private constant RENTER_SIGN_DATA_TYPEHASH =
        keccak256(
            bytes(
                "RenterSignData(address renter,uint256 maxDays,uint256 price,uint256 expiration,address _contract,uint256 tokenId,bytes32 fingerprint,bytes32 salt)"
            )
        );

    // State variables
    mapping(bytes => bool) public isSignatureRejected;

    // Structs
    struct RenterParams {
        address renter;
        uint256 maxDays;
        uint256 price;
        uint256 expiration;
        address _contract;
        uint256 tokenId;
        bytes32 fingerprint;
        bytes32 salt;
        bytes sig;
    }

    // Public functions
    function initialize(address _owner) external initializer {
        _transferOwnership(_owner);
        __EIP712_init("Rentals", "1");
    }

    function rent(RenterParams calldata _renterParams, uint256 _days) external {
        // Validate renter signature
        bytes32 renterMessageHash = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RENTER_SIGN_DATA_TYPEHASH,
                    _renterParams.renter,
                    _renterParams.maxDays,
                    _renterParams.price,
                    _renterParams.expiration,
                    _renterParams._contract,
                    _renterParams.tokenId,
                    _renterParams.fingerprint,
                    _renterParams.salt
                )
            )
        );

        address renter = ECDSAUpgradeable.recover(renterMessageHash, _renterParams.sig);

        require(renter == _renterParams.renter, "Rentals#rent: SIGNER_NOT_RENTER");

        // Validate parameters
        require(block.timestamp < _renterParams.expiration, "Rentals#rent: EXPIRED");
        require(_days <= _renterParams.maxDays, "Rentals#rent: TOO_MANY_DAYS");
        require(_days != 0, "Rentals#rent: ZERO_DAYS");
        require(msg.sender != _renterParams.renter, "Rentals#rent: RENTER_CANNOT_BE_TENANT");

        // Reject the renter signature so it cannot be used again
        _rejectSignature(_renterParams.sig);
    }

    function rejectSignatures(bytes[] memory _sigs) external {
        require(_sigs.length > 0, "Rentals#rejectSignatures: EMPTY_SIGNATURE_ARRAY");

        for (uint256 i = 0; i < _sigs.length; i++) {
            _rejectSignature(_sigs[i]);
        }
    }

    function _rejectSignature(bytes memory _sig) internal {
        require(_sig.length == 65, "Rentals#rejectSignature: INVALID_SIGNATURE_LENGTH");
        require(!isSignatureRejected[_sig], "Rentals#rejectSignature: ALREADY_REJECTED");

        isSignatureRejected[_sig] = true;
    }
}
