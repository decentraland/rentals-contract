// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract Rentals is OwnableUpgradeable {
    mapping(bytes => bool) public isSignatureRejected;

    struct RenterParams {
        bytes sig;
    }

    struct TenantParams {
        bytes sig;
    }

    function initialize(address _owner) external initializer {
        _transferOwnership(_owner);
    }

    function rent(
        RenterParams calldata _renterParams,
        TenantParams calldata _tenantParams
    ) external {
        bytes[] memory sigs;

        sigs[0] = _renterParams.sig;
        sigs[1] = _tenantParams.sig;

        rejectSignatures(sigs);
    }

    function rejectSignatures(bytes[] memory _sigs) public {
        require(
            _sigs.length > 0,
            "Rentals#rejectSignatures: EMPTY_SIGNATURE_ARRAY"
        );

        for (uint256 i = 0; i < _sigs.length; i++) {
            bytes memory _sig = _sigs[i];

            require(
                !isSignatureRejected[_sig],
                "Rentals#rejectSignature: ALREADY_REJECTED"
            );

            isSignatureRejected[_sig] = true;
        }
    }
}
