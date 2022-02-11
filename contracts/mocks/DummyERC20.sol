// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract DummyERC20 is ERC20 {
    constructor() ERC20("DummyERC20", "TKN") {}

    function mint(address _beneficiary, uint256 _amount) external {
        _mint(_beneficiary, _amount);
    }
}
