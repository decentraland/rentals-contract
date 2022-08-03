// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "../interfaces/IERC721Rentable.sol";
import "../Rentals.sol";

contract ReentrantERC721ThroughClaim is IERC721Rentable {
    Rentals rentals;
    uint256 tokenId;

    constructor(Rentals _rentals, uint256 _tokenId) {
        rentals = _rentals;
        tokenId = _tokenId;
    }

    /// @dev This function is called on every _rent.
    /// If Rentals.claim has a reentrancy guard, this should revert.
    function setUpdateOperator(uint256, address) external override {
        rentals.claim(address(this), tokenId);
    }

    // Ignored

    function supportsInterface(bytes4 interfaceId) external view override returns (bool) {}

    function balanceOf(address owner) external view override returns (uint256 balance) {}

    function ownerOf(uint256 tokenId) external view override returns (address owner) {}

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId
    ) external override {}

    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) external override {}

    function approve(address to, uint256 tokenId) external override {}

    function getApproved(uint256 tokenId) external view override returns (address operator) {}

    function setApprovalForAll(address operator, bool _approved) external override {}

    function isApprovedForAll(address owner, address operator) external view override returns (bool) {}

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes calldata data
    ) external override {}

    function verifyFingerprint(uint256, bytes memory) external view override returns (bool) {}
}
