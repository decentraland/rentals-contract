// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract DummyERC721 is ERC721 {
    constructor() ERC721("DummyERC721", "TKN") {}

    function mint(address _to, uint256 _id) external {
        _mint(_to, _id);
    }

    function setUpdateOperator(uint256, address) external {}
}
