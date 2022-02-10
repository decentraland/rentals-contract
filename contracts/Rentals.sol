// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/draft-EIP712Upgradeable.sol";

contract Rentals is OwnableUpgradeable, EIP712Upgradeable {
    // Constants
    bytes32 private constant RENTER_SIGN_DATA_TYPEHASH =
        keccak256(
            bytes(
                "RenterSignData(address renter,uint256 maxDays,uint256 price,uint256 expiration,address _contract,uint256 tokenId,bytes32 salt)"
            )
        );
    bytes32 private constant TENANT_SIGN_DATA_TYPEHASH =
        keccak256(
            bytes(
                "TenantSignData(address tenant,uint256 _days,uint256 expiration,address _contract,uint256 tokenId,bytes32 salt)"
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
        bytes32 salt;
        bytes sig;
    }

    struct TenantParams {
        address tenant;
        uint256 _days;
        uint256 expiration;
        address _contract;
        uint256 tokenId;
        bytes32 salt;
        bytes sig;
    }

    // Public functions
    function initialize(address _owner) external initializer {
        _transferOwnership(_owner);
        __EIP712_init("Rentals", "1");
    }

    function rent(
        RenterParams calldata _renterParams,
        TenantParams calldata _tenantParams,
        bytes[] memory _otherRejectSignatures
    ) external {
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
                    _renterParams.salt
                )
            )
        );

        address renter = ECDSAUpgradeable.recover(renterMessageHash, _renterParams.sig);

        require(renter == _renterParams.renter, "Rentals#rent: SIGNER_NOT_RENTER");

        // Validate tenant signature
        bytes32 tenantMessageHash = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    TENANT_SIGN_DATA_TYPEHASH,
                    _tenantParams.tenant,
                    _tenantParams._days,
                    _tenantParams.expiration,
                    _tenantParams._contract,
                    _tenantParams.tokenId,
                    _tenantParams.salt
                )
            )
        );

        address tenant = ECDSAUpgradeable.recover(tenantMessageHash, _tenantParams.sig);

        require(tenant == _tenantParams.tenant, "Rentals#rent: SIGNER_NOT_TENANT");

        // Reject signatures so they cannot be used again
        bytes[] memory sigs = new bytes[](2 + _otherRejectSignatures.length);

        sigs[0] = _renterParams.sig;
        sigs[1] = _tenantParams.sig;

        for (uint256 i = 0; i < _otherRejectSignatures.length; i++) {
            sigs[i + 2] = _otherRejectSignatures[i];
        }

        rejectSignatures(sigs);
    }

    function rejectSignatures(bytes[] memory _sigs) public {
        require(_sigs.length > 0, "Rentals#rejectSignatures: EMPTY_SIGNATURE_ARRAY");

        for (uint256 i = 0; i < _sigs.length; i++) {
            bytes memory _sig = _sigs[i];

            require(_sig.length == 65, "Rentals#rejectSignature: INVALID_SIGNATURE_LENGTH");
            require(!isSignatureRejected[_sig], "Rentals#rejectSignature: ALREADY_REJECTED");

            isSignatureRejected[_sig] = true;
        }
    }
}
