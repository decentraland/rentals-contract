// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "../interfaces/IERC721Rentable.sol";
import "../Rentals.sol";

contract ReentrantERC721 is IERC721Rentable {
    Rentals rentals;
    bytes data;

    constructor(Rentals _rentals) {
        rentals = _rentals;
    }

    /// @dev set the function data that will be called through the rentals contract on setUpdateOperator.
    /// This is intended to test reentrancy attacks, so make sure that the function data is of a public/external
    /// Rentals function.
    function setData(bytes memory _data) external {
        data = _data;
    }

    /// @dev This function is called on every _rent so it will be a convenient way of testing reentrancies.
    /// Will bubble up the error
    function setUpdateOperator(uint256, address) external override {
        (bool success, bytes memory returnData) = address(rentals).call(data);

        if (!success) {
            assembly {
                returnData := add(returnData, 0x04)
            }

            revert(abi.decode(returnData, (string)));
        }
    }

    // Ignored

    function setManyLandUpdateOperator(
        uint256 _tokenId,
        uint256[] memory _landTokenIds,
        address _operator
    ) external override {}

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
