// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract DummyComposableERC721 is ERC721 {
    bytes4 public constant ERC721Composable_ValidateFingerprint = 0x8f9f4b63;
    bytes4 public constant ERC721_Interface = 0x80ac58cd;

    mapping(uint256 => bytes32) public fingerprints;

    constructor() ERC721("DummyComposableERC721", "TKN") {}

    function mint(address _to, uint256 _id) external {
        super._mint(_to, _id);
        setFingerprint(_id, _id);
    }

    function verifyFingerprint(uint256 _tokenId, bytes memory _fingerprint) public view returns (bool) {
        return getFingerprint(_tokenId) == _bytesToBytes32(_fingerprint);
    }

    function getFingerprint(uint256 _tokenId) public view returns (bytes32) {
        return fingerprints[_tokenId];
    }

    function setFingerprint(uint256 _tokenId, uint256 _value) public {
        fingerprints[_tokenId] = bytes32(_value);
    }

    function supportsInterface(bytes4 _interfaceId) public pure override returns (bool) {
        return _interfaceId == ERC721Composable_ValidateFingerprint || _interfaceId == ERC721_Interface;
    }

    function safeTransferFromWithBytes(
        address from,
        address to,
        uint256 tokenId,
        bytes memory _data
    ) public {
        super.safeTransferFrom(from, to, tokenId, _data);
    }

    function _bytesToBytes32(bytes memory _data) internal pure returns (bytes32) {
        require(_data.length == 32, "The data should be 32 bytes length");

        bytes32 bidId;
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            bidId := mload(add(_data, 0x20))
        }
        return bidId;
    }

    function setUpdateOperator(uint256, address) external {}
}
