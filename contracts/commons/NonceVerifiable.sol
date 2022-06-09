// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

abstract contract NonceVerifiable is OwnableUpgradeable {
    /// @notice Current nonce at a contract level. Only updatable by the owner of the contract.
    /// Updating it will invalidate all signatures created with the previous value on a contract level.
    uint256 public contractNonce;

    /// @notice Current nonce per signer.
    /// Updating it will invalidate all signatures created with the previous value on a signer level.
    /// @custom:schema (signer address -> nonce)
    mapping(address => uint256) public signerNonce;

    /// @notice Current nonce per asset per signer.
    /// Updating it will invalidate all signatures created with the previous value on an asset level.
    /// @custom:schema (contract address -> token id -> signer address -> nonce)
    mapping(address => mapping(uint256 => mapping(address => uint256))) public assetNonce;

    event ContractNonceUpdated(uint256 _from, uint256 _to, address _sender);
    event SignerNonceUpdated(uint256 _from, uint256 _to, address _signer, address _sender);
    event AssetNonceUpdated(uint256 _from, uint256 _to, address _contractAddress, uint256 _tokenId, address _signer, address _sender);

    /// @notice As the owner of the contract, increase the contract nonce by 1.
    function bumpContractNonce() external onlyOwner {
        _bumpContractNonce();
    }

    /// @notice Increase the signer nonce of the sender by 1.
    function bumpSignerNonce() external {
        _bumpSignerNonce(_msgSender());
    }

    /// @notice Increase the asset nonce of the sender by 1.
    /// @param _contractAddress The contract address of the asset.
    /// @param _tokenId The token id of the asset.
    function bumpAssetNonce(address _contractAddress, uint256 _tokenId) external {
        _bumpAssetNonce(_contractAddress, _tokenId, _msgSender());
    }

    /// @dev Increase the contract nonce by 1
    function _bumpContractNonce() internal {
        uint256 previous = contractNonce;
        contractNonce++;

        emit ContractNonceUpdated(previous, contractNonce, _msgSender());
    }

    /// @dev Increase the signer nonce by 1
    function _bumpSignerNonce(address _signer) internal {
        uint256 previous = signerNonce[_signer];
        signerNonce[_signer]++;

        emit SignerNonceUpdated(previous, signerNonce[_signer], _signer, _msgSender());
    }

    /// @dev Increase the asset nonce by 1
    function _bumpAssetNonce(
        address _contractAddress,
        uint256 _tokenId,
        address _signer
    ) internal {
        uint256 previous = assetNonce[_contractAddress][_tokenId][_signer];
        assetNonce[_contractAddress][_tokenId][_signer]++;

        emit AssetNonceUpdated(previous, assetNonce[_contractAddress][_tokenId][_signer], _contractAddress, _tokenId, _signer, _msgSender());
    }

    /// @dev Reverts if the provided nonce does not match the contract nonce.
    function _verifyContractNonce(uint256 _nonce) internal view {
        require(_nonce == contractNonce, "NonceVerifiable#_verifyContractNonce: CONTRACT_NONCE_MISSMATCH");
    }

    /// @dev Reverts if the provided nonce does not match the signer nonce.
    function _verifySignerNonce(address _signer, uint256 _nonce) internal view {
        require(_nonce == signerNonce[_signer], "NonceVerifiable#_verifySignerNonce: SIGNER_NONCE_MISSMATCH");
    }

    /// @dev Reverts if the provided nonce does not match the asset nonce.
    function _verifyAssetNonce(
        address _contractAddress,
        uint256 _tokenId,
        address _signer,
        uint256 _nonce
    ) internal view {
        require(_nonce == assetNonce[_contractAddress][_tokenId][_signer], "NonceVerifiable#_verifyAssetNonce: ASSET_NONCE_MISSMATCH");
    }
}
