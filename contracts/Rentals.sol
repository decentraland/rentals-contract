// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/draft-EIP712Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import "./libraries/Require.sol";

contract Rentals is OwnableUpgradeable, EIP712Upgradeable, IERC721Receiver {
    // Constants
    bytes32 public constant RENTER_SIGN_DATA_TYPEHASH =
        keccak256(
            bytes(
                "RenterSignData(address renter,uint256 maxDays,uint256 price,uint256 expiration,address tokenAddress,uint256 tokenId,bytes fingerprint,bytes32 salt)"
            )
        );

    bytes4 public constant ERC721_Received = 0x150b7a02;

    // State variables
    mapping(bytes => bool) public isSignatureRejected;
    IERC20 public erc20Token;

    // Structs
    struct RenterParams {
        address renter;
        uint256 maxDays;
        uint256 price;
        uint256 expiration;
        address tokenAddress;
        uint256 tokenId;
        bytes fingerprint;
        bytes32 salt;
        bytes sig;
    }

    // Initializer
    function initialize(address _owner, IERC20 _erc20Token) external initializer {
        __EIP712_init("Rentals", "1");
        _setERC20Token(_erc20Token);
        _transferOwnership(_owner);
    }

    // Public functions
    function setERC20Token(IERC20 _erc20Token) external onlyOwner {
        _setERC20Token(_erc20Token);
    }

    function rent(RenterParams calldata _renterParams, uint256 _days) external {
        // Validate renter signature
        bytes32 renterMessageHash = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RENTER_SIGN_DATA_TYPEHASH,
                    _renterParams.renter,
                    _renterParams.maxDays,
                    _renterParams.price,
                    _renterParams.expiration,
                    _renterParams.tokenAddress,
                    _renterParams.tokenId,
                    keccak256(_renterParams.fingerprint),
                    _renterParams.salt
                )
            )
        );

        address renter = ECDSAUpgradeable.recover(renterMessageHash, _renterParams.sig);

        require(renter == _renterParams.renter, "Rentals#rent: SIGNER_NOT_RENTER");

        // Validate parameters
        require(_renterParams.price > 0, "Rentals#rent: INVALID_PRICE");
        require(block.timestamp < _renterParams.expiration, "Rentals#rent: EXPIRED");
        require(_days <= _renterParams.maxDays, "Rentals#rent: TOO_MANY_DAYS");
        require(_days != 0, "Rentals#rent: ZERO_DAYS");
        require(msg.sender != _renterParams.renter, "Rentals#rent: RENTER_CANNOT_BE_TENANT");

        // Validate NFT address
        Require._ERC721(_renterParams.tokenAddress);
        Require._composableERC721(_renterParams.tokenAddress, _renterParams.tokenId, _renterParams.fingerprint);

        // Transfer ERC721 token to the rentals contract
        IERC721(_renterParams.tokenAddress).safeTransferFrom(renter, address(this), _renterParams.tokenId);

        // Transfer ERC20 token from tenant to renter
        erc20Token.transferFrom(msg.sender, renter, _renterParams.price);

        // Reject the renter signature so it cannot be used again
        _rejectSignature(_renterParams.sig);
    }

    function rejectSignatures(bytes[] memory _sigs) external {
        require(_sigs.length > 0, "Rentals#rejectSignatures: EMPTY_SIGNATURE_ARRAY");

        for (uint256 i = 0; i < _sigs.length; i++) {
            _rejectSignature(_sigs[i]);
        }
    }

    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external override returns (bytes4) {
        return ERC721_Received;
    }

    // Private functions
    function _setERC20Token(IERC20 _erc20Token) internal {
        erc20Token = _erc20Token;
    }

    function _rejectSignature(bytes memory _sig) internal {
        require(_sig.length == 65, "Rentals#rejectSignature: INVALID_SIGNATURE_LENGTH");
        require(!isSignatureRejected[_sig], "Rentals#rejectSignature: ALREADY_REJECTED");

        isSignatureRejected[_sig] = true;
    }
}
