// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "./DummyNativeMetaTransactionImplementator.sol";

contract DummyRelayer {
    DummyNativeMetaTransactionImplementator nmtImplementator;

    bytes public data;

    constructor(DummyNativeMetaTransactionImplementator _nmtImplementator) {
        nmtImplementator = _nmtImplementator;
    }

    function executeAndStoreMetaTransactionResult(
        address _userAddress,
        bytes memory _functionData,
        bytes memory _signature
    ) external {
        data = nmtImplementator.executeMetaTransaction(_userAddress, _functionData, _signature);
    }
}
