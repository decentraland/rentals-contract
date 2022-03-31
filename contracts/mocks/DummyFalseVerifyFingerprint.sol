// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract DummyFalseVerifyFingerprint is ERC721 {
    bytes4 public constant ERC721Composable_ValidateFingerprint = 0x8f9f4b63;
    bytes4 public constant ERC721_Interface = 0x80ac58cd;

    mapping(uint256 => bytes32) public fingerprints;

    constructor() ERC721("DummyFalseVerifyFingerprint", "TKN") {}

    function mint(address _to, uint256 _id) external {
        super._mint(_to, _id);
        setFingerprint(_id, _id);
    }

    function verifyFingerprint(uint256, bytes memory) public pure returns (bool) {
        return false;
    }

    function setFingerprint(uint256 _tokenId, uint256 _value) public {
        fingerprints[_tokenId] = bytes32(_value);
    }

    function supportsInterface(bytes4 _interfaceId) public pure override returns (bool) {
        return _interfaceId == ERC721Composable_ValidateFingerprint || _interfaceId == ERC721_Interface;
    }
}
