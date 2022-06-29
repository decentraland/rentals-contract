// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IERC721Rentable is IERC721 {
    function setUpdateOperator(uint256, address) external;
    function verifyFingerprint(uint256, bytes memory) external view returns (bool);
}
