// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts/utils/Address.sol";

import "../interfaces/IERC721Verifiable.sol";

library Require {
    // Constants
    bytes4 public constant ERC721_Interface = 0x80ac58cd;
    bytes4 public constant ERC721Composable_ValidateFingerprint = 0x8f9f4b63;

    // Lib functions
    function _ERC721(address _tokenAddress) internal view {
        require(Address.isContract(_tokenAddress), "Require#_ERC721: ADDRESS_NOT_AtokenAddress");

        IERC721 token = IERC721(_tokenAddress);
        require(token.supportsInterface(ERC721_Interface), "Require#_ERC721: INVALIDtokenAddress_IMPLEMENTATION");
    }

    function _composableERC721(
        address _tokenAddress,
        uint256 _tokenId,
        bytes memory _fingerprint
    ) internal view {
        IERC721Verifiable composableToken = IERC721Verifiable(_tokenAddress);
        if (composableToken.supportsInterface(ERC721Composable_ValidateFingerprint)) {
            require(
                composableToken.verifyFingerprint(_tokenId, _fingerprint),
                "Require#_composableERC721: INVALID_FINGERPRINT"
            );
        }
    }
}
