// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "../commons/NonceVerifiable.sol";

contract DummyNonceVerifiableImplementator is NonceVerifiable {
    constructor(address _owner) {
        _transferOwnership(_owner);
    }

    function verifyContractNonce(uint256 _nonce) external view {
        _verifyContractNonce(_nonce);
    }

    function verifySignerNonce(address _signer, uint256 _nonce) external view {
        _verifySignerNonce(_signer, _nonce);
    }

    function verifyAssetNonce(
        address _contractAddress,
        uint256 _tokenId,
        address _signer,
        uint256 _nonce
    ) external view {
        _verifyAssetNonce(_contractAddress, _tokenId, _signer, _nonce);
    }
}
