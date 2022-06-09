// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "../commons/NativeMetaTransaction.sol";

contract DummyNativeMetaTransactionImplementator is NativeMetaTransaction {
    uint256 public counter;
    address public increaseCounterCaller;

    function initialize() external initializer {
        __EIP712_init("DummyNativeMetaTransactionImplementator", "1");
    }

    function increaseCounter(uint256 _amount) external {
        increaseCounterCaller = _getMsgSender();
        counter += _amount;
    }

    function sum(uint256 _a, uint256 _b) external pure returns (uint256) {
        return _a + _b;
    }

    function functionThatReverts() external pure {
        revert("ALWAYS_REVERTING_NEVER_INREVERTING");
    }

    function functionThatRevertsSilently() external pure {
        revert();
    }
}
