// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract NonceVerifiable is OwnableUpgradeable {
    // Nonces used to invalidate signatures.
    uint256 public contractNonce;
    // (signer address -> nonce)
    mapping(address => uint256) public signerNonce;
    // (contract address -> token id -> signer address -> nonce)
    mapping(address => mapping(uint256 => mapping(address => uint256))) public assetNonce;

    event ContractNonceUpdated(uint256 _from, uint256 _to, address _sender);
    event SignerNonceUpdated(uint256 _from, uint256 _to, address _sender);
    event AssetNonceUpdated(uint256 _from, uint256 _to, address _contractAddress, uint256 _tokenId, address _signer, address _sender);

    // Public

    /**
    @notice Increase by 1 the contract nonce
    @dev This can be used to invalidate all signatures created with the previous nonce.
     */
    function bumpContractNonce() external onlyOwner {
        _bumpContractNonce();
    }

    /**
    @notice Increase by 1 the signer nonce
    @dev This can be used to invalidate all signatures created by the caller with the previous nonce.
     */
    function bumpSignerNonce() external {
        _bumpSignerNonce(_msgSender());
    }

    /**
    @notice Increase by 1 the asset nonce
    @dev This can be used to invalidate all signatures created by the caller for a given asset with the previous nonce.
    @param _contractAddress The contract address of the asset.
    @param _tokenId The token id of the asset.
     */
    function bumpAssetNonce(address _contractAddress, uint256 _tokenId) external {
        _bumpAssetNonce(_contractAddress, _tokenId, _msgSender());
    }

    // Private

    function _bumpContractNonce() internal {
        uint256 previous = contractNonce;
        contractNonce++;

        emit ContractNonceUpdated(previous, contractNonce, _msgSender());
    }

    function _bumpSignerNonce(address _signer) internal {
        uint256 previous = signerNonce[_signer];
        signerNonce[_signer]++;

        emit SignerNonceUpdated(previous, signerNonce[_signer], _signer);
    }

    function _bumpAssetNonce(
        address _contractAddress,
        uint256 _tokenId,
        address _signer
    ) internal {
        uint256 previous = assetNonce[_contractAddress][_tokenId][_signer];
        assetNonce[_contractAddress][_tokenId][_signer]++;

        emit AssetNonceUpdated(previous, assetNonce[_contractAddress][_tokenId][_signer], _contractAddress, _tokenId, _signer, _msgSender());
    }
}
