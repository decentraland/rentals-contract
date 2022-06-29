// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @notice Extended ERC721 interface with methods required by the Rentals contract.
interface IERC721Rentable is IERC721 {
    /// @dev Updates the operator of the asset.
    function setUpdateOperator(uint256, address) external;
    /// @dev Checks that the provided fingerprint matches the fingerprint of the composable asset.
    function verifyFingerprint(uint256, bytes memory) external view returns (bool);
}
