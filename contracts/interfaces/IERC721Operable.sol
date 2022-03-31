// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IERC721Operable is IERC721 {
    function setUpdateOperator(uint256, address) external;
}
