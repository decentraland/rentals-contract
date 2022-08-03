// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "../Rentals.sol";

/// @dev Extension of the Rentals contract to expose some internal elements for testing.
contract ExtendedRentals is Rentals {
    function getEIP712NameHash() external view virtual returns (bytes32) {
        return _EIP712NameHash();
    }

    function getEIP712VersionHash() external view virtual returns (bytes32) {
        return _EIP712VersionHash();
    }
}
