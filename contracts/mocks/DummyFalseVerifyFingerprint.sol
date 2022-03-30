// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

contract DummyFalseVerifyFingerprint {
    function supportsInterface(bytes4) public pure returns (bool) {
        return true;
    }

    function verifyFingerprint(uint256, bytes memory) public pure returns (bool) {
        return false;
    }
}
