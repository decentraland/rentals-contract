# Rentals Contract

This contract provides on-chain renting capabilities for Decentraland's LAND and Estates.

By capitalizing on off-chain signatures, users only need to spend gas on critical transactions and avoid operations that can be done safely off-chain like handling listings or offers.

This contract is intended for Decentraland's LAND and Estates but can be used with any ERC721 that has a `setUpdateOperator` function to give operator permissions to an address. For both of these assets, the update operator can deploy scenes on them.

There are various ways to initialize a rent. What all of them have in common is that a user has to send a transaction to initialize the rent using a signature created off-chain by another user as verification of the rental conditions.

## Index

- [Listing](#listing)
- [Accepting a Listing](#accepting-a-listing)
- [Offers](#offers)
- [Accepting an Offer](#accepting-an-offer)
- [Claiming back the Asset](#claiming-back-the-asset)
- [Changing the Update Operator of the Asset](#changing-the-update-operator-of-the-asset)
- [What happens when the rental ends?](#what-happens-when-the-rental-ends)
- [Extending a rental](#extending-a-rental)
- [Nonces](#nonces)
- [Invalidating Signatures](#invalidating-signatures)
- [Development](#development)

## Listing

If I wanted to rent my LAND in order to accrue an extra income from it, I could do so by:

<a id="authorize-rentals-contract"></a>
1 - Authorizing the Rentals contract to operate LAND

You can do so by calling `approve` on the LAND contract with the address of the Rentals contract and the token id of the LAND you want to rent.

You can also do it with `setApprovalForAll` on the LAND contract with the address of the Rentals contract.

The difference between one and the other is that you will need to call `approve` for each individual LAND you want to rent, while with `setApprovalForAll` you only have to do it once for all your assets in the contract.

2 - Sign the rental conditions

There are various conditions that you can set for a rental to occur. You can have a glimpse of what these conditions are by looking at the Listing struct.

<a id="listing-struct"></a>
```
struct Listing {
    address signer;
    address contractAddress;
    uint256 tokenId;
    uint256 expiration;
    uint256[3] nonces;
    uint256[] pricePerDay;
    uint256[] maxDays;
    uint256[] minDays;
    address target;
    bytes signature;
}
```

- signer: The address of the signer, in this case, my address.
- contractAddress: The address of the LAND contract.
- tokenId: The token id of the LAND I want to rent.
- expiration: The timestamp from which the signature will not be valid anymore.
- nonces: The three of them have to match the current nonces in the Rentals contract to be valid. Find more about it in the [Nonces](#nonces) section.
- pricePerDay: Defines the price per day for the min and max days range in the same index.
- maxDays: max amount of days the LAND can be rented for a given index.
- minDays: min amount of days the LAND can be rented for a given index.
- target: If defined, only the target address can use the signature, if not, anyone can.
- signature: The signature created by signing all the previous data

There are various ways of signing these conditions. One of them can be achieved by using ethers as seen in the [./test/utlils/rentals.ts](https://github.com/decentraland/rentals-contract/blob/main/test/utils/rentals.ts#L26) utility file.

Once both the signature and the listings conditions are ready, I, or whichever off-chain system handling this, can store them to make them 
available for interested users that want to rent my LAND.

The interested user can interact with the Rentals contract via `acceptListing` with this data to initialize the rent. You can see more about [Accept Listing](#accepting-a-listing) in its corresponding section.

## Accepting a Listing

In the case that I am interested in renting a LAND as a tenant I can do the following:

1 - Authorize the Rentals contract to transfer my MANA

Rentals are paid upfront once they are initialized. For this, the Rentals contract needs authorization to move my MANA to the owner of the LAND I'm renting and a small cut to the DAO.

To do this, I can simply call the `approve` function in the MANA contract with the address of the Rentals contract as the spender and a value of MANA greater or equal to the price I have to pay for the rental. I could set an incredibly large number as the value so with just 1 authorization, I can forget about doing it again in the future and just go to step 2 directly.

2 - Obtain a listing and its corresponding signature

In order to accept a listing, I would need to get the listing conditions as well as a signature created by the owner of the LAND I want to rent. This depends on the off-chain system the owner has used to store the information. But once I obtain them, I'm good to call the `acceptListing` function and start the rental.

3 - Call `acceptListing` in the Rentals contract

Once the previous information is at hand, I can finally call the function to accept the listing.

```
function acceptListing(
    Listing calldata _listing,
    address _operator,
    uint256 _index,
    uint256 _rentalDays,
    bytes32 _fingerprint
) external
```

- listing: [Listing](#listing-struct) data containing both the conditions and the signature of owner of the LAND.
- operator: The address that will be given operator permitions via the `setUpdateOperator` in the LAND contract. In other words, the user that I want being able to deploy scenes in that LAND, it could be myself if I wanted to but maybe I want someone else to do it.
- index: Remember that the Listing contains arrays for pricePerDay, maxDays and minDays? This value determines which index of those arrays I want to choose for this rental.
- rentalDays: The amount of days I want to rent this LAND. It has to be in range between the min and max days of the index I choose or else it fails.
- fingerprint: In the case of an Estate, this indicates the fingerprint it should have when renting it to me. This prevents the owner to front run me and remove LAND from it before renting it.

If everything is correct, MANA equivalent to the pricePerDay index I've selected, times the rentalDays I provided will be transfered from my address to the lessor (and a fee to the DAO) and the provided operator will start being able to deploy scenes to that LAND.

## Offers

This is the contrary of a [Listing](#listing). In this case, me, as a user interested of renting a certain LAND, would like to sign an Offer for said LAND so the owner has the possibility of renting it to me.

Similar to the Listing, I would need to sign the Offer conditions. These conditions can be seen in the Offer struct of the Rentals contract:

<a id="offer-struct"></a>
```
struct Offer {
    address signer;
    address contractAddress;
    uint256 tokenId;
    uint256 expiration;
    uint256[3] nonces;
    uint256 pricePerDay;
    uint256 rentalDays;
    address operator;
    bytes32 fingerprint;
    bytes signature;
}
```

- signer: The address of the signer, in this case, my address.
- contractAddress: The address of the LAND contract.
- tokenId: The token id of the LAND I want to rent.
- expiration: The timestamp from which the signature will not be valid anymore.
- nonces: The three of them have to match the current nonces in the Rentals contract to be valid. Find more about it in the [Nonces](#nonces) section.
- pricePerDay: Defines the price per day I'm willing to pay for renting the LAND
- rentalDays: The amount of days I want to rent the LAND
- operator: The address that will be given operator permissions to deploy scenes to that LAND
- fingerprint: If the asset would be an Estate, the fingerprint of that Estate should match the one I'm providing so the owner cannot remove LAND from it before renting it to me.
- signature: The signature created by signing all the previous data

There are various ways of signing these conditions. One of them can be achieved by using ethers as seen in the [./test/utlils/rentals.ts](https://github.com/decentraland/rentals-contract/blob/main/test/utils/rentals.ts#L81) utility file.

Once both the signature and the listings conditions are ready, I, or whichever off-chain handling this, can store them to make them 
available for the interested owner of that LAND to accept it.

If the owner of the the LAND is interested in the offer, they can interact with the Rentals contract via `acceptOffer` or by sending the asset to the Rentals contract via the `safeTransferFrom` function in the LAND contract, providing the Offer in the last `bytes` parameter. More info on this can be found in the [Accepting an Offer](#accepting-an-offer) section.

## Accepting an Offer

Me, as the current owner of a LAND, see that there is an offer by a much generous user that wants to rent my LAND for a year and for a lot of MANA.

There are 2 ways in which, with the Offer condition and the offer signature in my possesion, can initialize the rent.

1 - Calling the `acceptListing` function in the Rentals contract. 

This function, similarly to Listing, requires that I, as the owner, [authorize](#authorize-rentals-contract) the Rentals contract to transfer the LAND.

Once that is out of the way, I can call `acceptListing` function to initialize the rent.

This function only receives one parameter as you can see in the following line:

```
function acceptOffer(Offer calldata _offer) external
```

- offer: [Offer](#offer-struct) containing the conditions and the signature of the offer.

2 - Sending the LAND to the Rentals cotract via LAND's `safeTransferFrom` function

Using this method allows me to bypass the authorization requirement, saving some gas fees in the process.

```
function safeTransferFrom(address from, address to, uint256 assetId, bytes userData) external;
```

- from: My address
- to: The Rentals contract address
- assetId: The token id of my LAND
- userData: The [Offer](#offer-struct) in bytes

There are many examples on how to create an Offer with ethers in various [onERC721Received](https://github.com/decentraland/rentals-contract/blob/main/test/Rentals.spec.ts#L2299) tests.

If everything is correct after using any of the 2 previous options to accept an offer, MANA equivalent to the pricePerDay times the rentalDays provided in the offer will be transfered from the tenant to my address (minus a fee for the DAO) and the provided operator in the offer will start being able to deploy scenes to that LAND.

## Claiming back the Asset

Using LAND as an example, when a rental starts, that rented LAND is transfered to the Rentals contract.

I can get my LAND back ONLY when the rental has finished by calling the `claim` function. 

```
function claim(address _contractAddress, uint256 _tokenId) external
```

- contractAddress: The address of the LAND contract.
- tokenId: The id of the LAND.

Once the transaction finishes successfuly, the LAND will be transfered back to me.

Due to how the LAND contract works, claiming the asset back will remove the update operator role from the user that had it during the rent.

## Changing the Update Operator of the Asset

When accepting an offer or a listing, the tenant provides an address that will act as the update operator of the LAND. This allows that address, once the rental starts, to be able to deploy scenes to the LAND.

As the tenant (The one that pays for the rental), while the rental is ongoing, I can call the `setOperator` function in the Rentals contract to change the address of the asset's update operator.

```
function setOperator(
    address _contractAddress,
    uint256 _tokenId,
    address _operator
) external
```

- contractAddress: Address of the LAND contract
- tokenId: Id of the rented LAND
- operator: Address of the new address that will have an update operator role for that LAND.

As the tenant, I can only call this funtion when the rental is ongoing.

As the lessor, I can call this function after the rental is over.

## What happens when the rental ends?

Once of the most important things to keep in mind when a rental ends, is that the update operator defined by the tenant will still be able to deploy scenes to the LAND.

This is because in order to change or remove the update operator from a LAND, the `setUpdateOperator` function of the asset has to be manually called.

As the original owner of the asset, once the rental is over and I really don't want the operator defined by the tenant to keep deploying stuff after the rental period ends, I could do the following:

- Set the update operator manually to one of my liking as instructed [here](#changing-the-update-operator-of-the-asset).
- Claim the asset back as instructed [here](#claiming-back-the-asset).
- Accept a new Offer as instructed [here](#accepting-an-offer), changing the operator of the LAND to the new tenant's operator.
- Having a Listing accepted by a new tenant as instructed [here](#accepting-a-listing), changing the operator of the LAND to the new tenant's operator.

Another important thing to keep in mind is that there is NO need to claim the asset back once the rental is over to rent it again. 

After the rent of a LAND is over, the lessor can accept and offer or have a listing accepted and the LAND will be re-rented. This is useful because it saves the original owner from some extra transactions.

## Extending a rental

BEFORE a rental is over, a new listing or offer for the LAND can be accepted as long as the lessor and tenant in said offer/listing are the same.

Doing so will extend the end date of the rental by the amount of rental days defined.

## Nonces

The Rentals contract contains various nonces of different types used to verify if a signature is valid. They can be modified used to [Invalidate Signatures](#invalidating-signatures) in many levels.

- contractNonce: A nonce that once its changed by the owner of the contract, will make all signatures signed with the previous value invalid.
- signerNonce: A nonce that once its changed by sender of the transaction, will make all signatures signed by the sender invalid.
- assetNonce: A nonce that once its changed by sender of the transaction, will make all signatures signed by the sender for a given asset invalid.

The `uint256[3] nonces;` field in the [Listing](#listing-struct) struct, in order to be valid. must be conformed by the current [contactNonce, signerNonce, assetNonce].

For example, if I wanted to sign a listing, I would need to ask the Rentals contract for these values via the public variables exposed:

```
uint256 public contractNonce;
mapping(address => uint256) public signerNonce;
mapping(address => mapping(uint256 => mapping(address => uint256))) public assetNonce;
```

In pseudo js code, if I wanted to rent a LAND, I would need to obtain the nonces doing something like this:

```
const contractNonce = await rentalsContract.contractNonce();
const signerNonce = await rentalsContract.signerNonce(myAddress);
const assetNonce = await rentalsContract.contractNonce(landContractAddress, landTokenId, myAddress);

const listing = {
  ...otherParams,
  nonces: [contractNonce, signerNonce, assetNonce]
}
```

## Invalidating Signatures

Users can invalidate signatures in different ways by updating the contractNonce, the signerNonce and the assetNonce.

They can do so by calling the following functions in the Rentals contract.

```
function bumpContractNonce() external onlyOwner
function bumpSignerNonce() external
function bumpAssetNonce(address _contractAddress, uint256 _tokenId) external
```

`bumpContractNonce` can only be called by the owner of the Rentals contract, and will be used only on an emergency to invalidate all signatures created with the current nonce.

`bumpSignerNonce` can be called by any user, and will invalidate all signatures created by that user with the current nonce.

`bumpAssetNonce` can be called by any user, and will invalidate all signatures created by that user for a given asset with the current nonce.

The asset nonce is always bumped for both the lessor and the tenant once a rent is initialized to prevent any other listings or offers with the current nonce to be usable. This is a safety meassure to ensure that the least amount of usable signatures are available off-chain in the case of a signature storage breach.

In the case of the signer nonce, imagine that I signed a lot of listings or offers with the current nonce but for some reason I don't trust the way they are stored, I could just call the asset nonce bump to invalidate them all at once.

The case with the asset nonce is similar but targeted to a certain asset.

## Development

Install dependencies with `npm ci`

Compile contracts with `npm run compile`

Run tests with `npm run test`

Run tests with coverage with `npm run test:coverage`
