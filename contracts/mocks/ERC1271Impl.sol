// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

contract ERC1271Impl {
    bool private immutable isValidSignatureResponse;

    constructor(bool _isValidSignatureResponse) {
        isValidSignatureResponse = _isValidSignatureResponse;
    }

    function isValidSignature(
        bytes32, //_hash
        bytes memory // _signature
    ) external view returns (bytes4 magicValue) {
        if (isValidSignatureResponse) {
            return 0x1626ba7e;
        } else {
            return 0;
        }
    }
}
