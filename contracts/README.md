# contracts

Foundry project for the Gleamers `Payments` contract.

## Install Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

## Install dependencies

```bash
cd contracts
forge install foundry-rs/forge-std --no-commit
```

## Build / test

```bash
forge build
forge test
```

The `Payments` contract is scaffolded empty — the implementation
(super chats, deploy fees, splits, burn address) lands in a later
prompt. Revenue flows, once wired up:

- Super chat: 90% streamer owner, 10% treasury
- Deploy fee: 20% burned, 80% treasury
