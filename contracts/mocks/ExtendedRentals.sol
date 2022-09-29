// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "../Rentals.sol";

/// @notice Extension of the Rentals contract to check that EIP712 is initialized correctly.
/// @dev This contract is used for testing purposes only and should not be used in production.
contract ExtendedRentals is Rentals {
    /// @notice Get the EIP712NameHash
    /// @return The EIP712NameHash
    function getEIP712NameHash() external view virtual returns (bytes32) {
        return _EIP712NameHash();
    }

    /// @notice Get the EIP712VersionHash
    /// @return The EIP712VersionHash
    function getEIP712VersionHash() external view virtual returns (bytes32) {
        return _EIP712VersionHash();
    }
}
