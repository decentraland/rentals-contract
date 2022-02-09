// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract Rentals is OwnableUpgradeable {
  function initialize(address _owner) external initializer {
    _transferOwnership(_owner);
  }
}
