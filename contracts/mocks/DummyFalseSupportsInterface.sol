// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract DummyFalseSupportsInterface {
    function supportsInterface(bytes4) public pure returns (bool) {
        return false;
    }
}
