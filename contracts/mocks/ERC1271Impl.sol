// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

import "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";

/// @dev Mock contract for testing ERC1271 signature verification in the Rentals contract.
contract ERC1271Impl {
    address private immutable owner;

    constructor(address _owner) {
        owner = _owner;
    }

    function isValidSignature(bytes32 _hash, bytes memory _signature) external view returns (bytes4 magicValue) {
        (address signer, ) = ECDSAUpgradeable.tryRecover(_hash, _signature);

        if (owner == signer) {
            return 0x1626ba7e;
        } else {
            return 0;
        }
    }
}
