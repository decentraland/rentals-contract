// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts/utils/Address.sol";

import "../interfaces/IERC721Verifiable.sol";
import "../interfaces/IERC721Operable.sol";

library Require {
    bytes4 public constant ERC721_Interface = 0x80ac58cd;
    bytes4 public constant ERC721Composable_ValidateFingerprint = 0x8f9f4b63;
    bytes4 public constant ERC721Operable_SetUpdateOperator = 0xb0b02c60;

    /// @notice Check that the provided address belongs to an ERC721 contract.
    /// @param _tokenAddress - Address of the contract to be checked.
    function isERC721(address _tokenAddress) internal view {
        require(Address.isContract(_tokenAddress), "Require#isERC721: ADDRESS_NOT_A_CONTRACT");
        IERC721 token = IERC721(_tokenAddress);
        require(token.supportsInterface(ERC721_Interface), "Require#isERC721: ADDRESS_NOT_AN_ERC721");
    }

    /// @notice Check that the provided address belongs to a composable ERC721.
    /// @param _tokenAddress - Address of the contract to be checked.
    /// @param _tokenId - Token id of the asset to be checked.
    /// @param _fingerprint - Fingerprint of the asset to be checked.
    function isComposableERC721(
        address _tokenAddress,
        uint256 _tokenId,
        bytes memory _fingerprint
    ) internal view {
        IERC721Verifiable composableToken = IERC721Verifiable(_tokenAddress);
        if (composableToken.supportsInterface(ERC721Composable_ValidateFingerprint)) {
            require(
                composableToken.verifyFingerprint(_tokenId, _fingerprint),
                "Require#isComposableERC721: INVALID_FINGERPRINT"
            );
        }
    }

    /// @notice Check that the provided address contains a function to set the operator.
    /// @param _tokenAddress - Address of the contract to be checked.
    function isOperableERC721(address _tokenAddress) internal view {
        IERC721Operable operable = IERC721Operable(_tokenAddress);
        bool supportsInterface = operable.supportsInterface(ERC721Operable_SetUpdateOperator);
        require(supportsInterface, "Require#isOperableERC721: ADDRESS_NOT_OPERABLE");
    }
}
