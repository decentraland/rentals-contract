// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "../external/EIP712Upgradeable.sol";

abstract contract NativeMetaTransaction is EIP712Upgradeable {
    bytes32 private constant META_TRANSACTION_TYPEHASH = keccak256(bytes("MetaTransaction(uint256 nonce,address from,bytes functionSignature)"));

    event MetaTransactionExecuted(address _userAddress, address _relayerAddress, bytes _functionSignature);

    mapping(address => uint256) nonces;

    struct MetaTransaction {
        uint256 nonce;
        address from;
        bytes functionSignature;
    }

    function getNonce(address _user) external view returns (uint256 nonce) {
        nonce = nonces[_user];
    }

    function executeMetaTransaction(
        address _userAddress,
        bytes memory _functionSignature,
        bytes memory _signature
    ) external payable returns (bytes memory) {
        MetaTransaction memory metaTx = MetaTransaction({nonce: nonces[_userAddress], from: _userAddress, functionSignature: _functionSignature});

        require(_verify(_userAddress, metaTx, _signature), "NMT#executeMetaTransaction: SIGNER_AND_SIGNATURE_DO_NOT_MATCH");

        // increase nonce for user (to avoid re-use)
        nonces[_userAddress]++;

        emit MetaTransactionExecuted(_userAddress, msg.sender, _functionSignature);

        // Append userAddress and relayer address at the end to extract it from calling context
        (bool success, bytes memory returnData) = address(this).call{value: msg.value}(abi.encodePacked(_functionSignature, _userAddress));

        require(success, "NMT#executeMetaTransaction: CALL_FAILED");

        return returnData;
    }

    function _verify(
        address _signer,
        MetaTransaction memory _metaTx,
        bytes memory _signature
    ) private view returns (bool) {
        require(_signer != address(0), "NMT#_verify: INVALID_SIGNER");

        bytes32 msgHash = _hashTypedDataV4(_hashMetaTransaction(_metaTx));

        return _signer == ECDSAUpgradeable.recover(msgHash, _signature);
    }

    function _hashMetaTransaction(MetaTransaction memory _metaTx) private pure returns (bytes32) {
        return keccak256(abi.encode(META_TRANSACTION_TYPEHASH, _metaTx.nonce, _metaTx.from, keccak256(_metaTx.functionSignature)));
    }
}
