// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts-upgradeable/utils/cryptography/draft-EIP712Upgradeable.sol";

abstract contract NativeMetaTransaction is EIP712Upgradeable {
    /// @dev EIP712 type hash for recovering the signer from the signature.
    bytes32 private constant META_TRANSACTION_TYPEHASH = keccak256(bytes("MetaTransaction(uint256 nonce,address from,bytes functionData)"));

    /// @notice Track signer nonces so the same signature cannot be used more than once.
    mapping(address => uint256) public nonces;

    /// @notice Struct with the data required to verify that the signature signer is the same as `from`.
    struct MetaTransaction {
        uint256 nonce;
        address from;
        bytes functionData;
    }

    event MetaTransactionExecuted(address _userAddress, address _relayerAddress, bytes _functionData);

    /// @notice Execute a transaction from the contract appending _userAddress to the call data.
    /// @dev The appended address can then be extracted from the called context with _getMsgSender instead of using msg.sender.
    /// The caller of `executeMetaTransaction` will pay for gas fees so _userAddress can experience "gasless" transactions.
    /// @param _userAddress The address appended to the call data.
    /// @param _functionData Data containing information about the contract function to be called.
    /// @param _signature Signature created by _userAddress to validate that they wanted
    /// @return The data as bytes of what the relayed function would have returned.
    function executeMetaTransaction(
        address _userAddress,
        bytes memory _functionData,
        bytes memory _signature
    ) external payable returns (bytes memory) {
        MetaTransaction memory metaTx = MetaTransaction({nonce: nonces[_userAddress], from: _userAddress, functionData: _functionData});

        require(_verify(_userAddress, metaTx, _signature), "NativeMetaTransaction#executeMetaTransaction: SIGNER_AND_SIGNATURE_DO_NOT_MATCH");

        nonces[_userAddress]++;

        emit MetaTransactionExecuted(_userAddress, msg.sender, _functionData);

        (bool success, bytes memory returnData) = address(this).call{value: msg.value}(abi.encodePacked(_functionData, _userAddress));

        // Bubble up error based on https://github.com/Uniswap/v3-periphery/blob/v1.0.0/contracts/base/Multicall.sol
        if (!success) {
            if (returnData.length < 68) {
                // Revert silently when there is no message in the returned data.
                revert();
            }

            assembly {
                // Remove the selector.
                returnData := add(returnData, 0x04)
            }

            revert(abi.decode(returnData, (string)));
        }

        return returnData;
    }

    function _verify(
        address _signer,
        MetaTransaction memory _metaTx,
        bytes memory _signature
    ) private view returns (bool) {
        bytes32 structHash = keccak256(abi.encode(META_TRANSACTION_TYPEHASH, _metaTx.nonce, _metaTx.from, keccak256(_metaTx.functionData)));
        bytes32 typedDataHash = _hashTypedDataV4(structHash);

        return _signer == ECDSAUpgradeable.recover(typedDataHash, _signature);
    }

    /// @dev Extract the address of the sender from the msg.data if available. If not, fallback to returning the msg.sender.
    /// @dev It is vital that the implementator uses this function for meta transaction support.
    function _getMsgSender() internal view returns (address sender) {
        if (msg.sender == address(this)) {
            bytes memory array = msg.data;
            uint256 index = msg.data.length;
            assembly {
                // Load the 32 bytes word from memory with the address on the lower 20 bytes, and mask those.
                sender := and(mload(add(array, index)), 0xffffffffffffffffffffffffffffffffffffffff)
            }
        } else {
            sender = msg.sender;
        }

        return sender;
    }
}
