// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Payments
/// @notice Super chats and deploy fees for Gleamers.
///         Super chat split: 90% streamer owner, 10% treasury.
///         Deploy fee split: 20% burned (dead address), 80% treasury.
///         The payer must ERC20-approve this contract for the required
///         amount before calling superChat() or payDeployFee(). The
///         contract routes two transferFrom calls per action and does
///         not custody tokens.
contract Payments is Ownable {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------

    IERC20 public immutable token;

    address public treasury;
    address public deadAddress;
    bool public paused;

    /// @notice Super chat price per tier (1, 2, 3). 0 disables the tier.
    mapping(uint8 => uint256) public superChatTierAmounts;

    /// @notice Deploy fee in token base units. 0 disables new deploys.
    uint256 public deployFeeAmount;

    // -------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------

    event SuperChat(
        address indexed payer,
        bytes32 indexed streamerId,
        address indexed owner,
        uint8 tier,
        uint256 amount,
        bytes32 messageHash,
        uint256 timestamp
    );

    event DeployFeePaid(
        address indexed payer,
        bytes32 indexed deployId,
        uint256 amount,
        uint256 burnAmount,
        uint256 treasuryAmount,
        uint256 timestamp
    );

    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event DeadAddressUpdated(address oldDead, address newDead);
    event PausedUpdated(bool paused);
    event TierAmountUpdated(uint8 tier, uint256 amount);
    event DeployFeeUpdated(uint256 amount);
    event EmergencyWithdraw(address indexed token, address indexed to, uint256 amount);

    // -------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------

    error PaymentsPaused();
    error InvalidTier();
    error TierDisabled();
    error DeployDisabled();
    error InvalidOwner();
    error InvalidTreasury();
    error InvalidDeadAddress();

    // -------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------

    modifier whenNotPaused() {
        if (paused) revert PaymentsPaused();
        _;
    }

    // -------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------

    constructor(
        IERC20 _token,
        address _treasury,
        address _deadAddress,
        address _admin
    ) Ownable(_admin) {
        if (address(_token) == address(0)) revert InvalidOwner();
        if (_treasury == address(0)) revert InvalidTreasury();
        if (_deadAddress == address(0)) revert InvalidDeadAddress();

        token = _token;
        treasury = _treasury;
        deadAddress = _deadAddress;
    }

    // -------------------------------------------------------------------
    // User actions
    // -------------------------------------------------------------------

    /// @notice Pay a super chat. The payer must have approved this
    /// contract for at least the tier amount. 90% goes to the streamer
    /// owner, 10% to the treasury.
    /// @param streamerId  opaque id for the streamer (off-chain uuid hash)
    /// @param tier        1, 2, or 3
    /// @param messageHash keccak of the message body (on-chain receipt)
    /// @param streamerOwner address that receives the owner share
    function superChat(
        bytes32 streamerId,
        uint8 tier,
        bytes32 messageHash,
        address streamerOwner
    ) external whenNotPaused {
        if (tier < 1 || tier > 3) revert InvalidTier();
        uint256 amount = superChatTierAmounts[tier];
        if (amount == 0) revert TierDisabled();
        if (streamerOwner == address(0)) revert InvalidOwner();

        uint256 ownerShare = (amount * 90) / 100;
        uint256 treasuryShare = amount - ownerShare;

        token.safeTransferFrom(msg.sender, streamerOwner, ownerShare);
        token.safeTransferFrom(msg.sender, treasury, treasuryShare);

        emit SuperChat(
            msg.sender,
            streamerId,
            streamerOwner,
            tier,
            amount,
            messageHash,
            block.timestamp
        );
    }

    /// @notice Pay the deploy fee for a pending streamer. 20% burned,
    /// 80% to treasury. The payer must have approved this contract for
    /// at least `deployFeeAmount`.
    /// @param deployId opaque id for the pending deploy (off-chain uuid hash)
    function payDeployFee(bytes32 deployId) external whenNotPaused {
        uint256 amount = deployFeeAmount;
        if (amount == 0) revert DeployDisabled();

        uint256 burnShare = (amount * 20) / 100;
        uint256 treasuryShare = amount - burnShare;

        token.safeTransferFrom(msg.sender, deadAddress, burnShare);
        token.safeTransferFrom(msg.sender, treasury, treasuryShare);

        emit DeployFeePaid(
            msg.sender,
            deployId,
            amount,
            burnShare,
            treasuryShare,
            block.timestamp
        );
    }

    // -------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidTreasury();
        address old = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(old, newTreasury);
    }

    function setDeadAddress(address newDead) external onlyOwner {
        if (newDead == address(0)) revert InvalidDeadAddress();
        address old = deadAddress;
        deadAddress = newDead;
        emit DeadAddressUpdated(old, newDead);
    }

    function setPaused(bool newPaused) external onlyOwner {
        paused = newPaused;
        emit PausedUpdated(newPaused);
    }

    function setTierAmount(uint8 tier, uint256 amount) external onlyOwner {
        if (tier < 1 || tier > 3) revert InvalidTier();
        superChatTierAmounts[tier] = amount;
        emit TierAmountUpdated(tier, amount);
    }

    function setDeployFee(uint256 amount) external onlyOwner {
        deployFeeAmount = amount;
        emit DeployFeeUpdated(amount);
    }

    /// @notice Rescue tokens accidentally sent to this contract. Because
    /// the contract normally routes with transferFrom and never custodies
    /// tokens, the only way funds land here is by mistake.
    function emergencyWithdraw(IERC20 stuck, address to, uint256 amount)
        external
        onlyOwner
    {
        if (to == address(0)) revert InvalidTreasury();
        stuck.safeTransfer(to, amount);
        emit EmergencyWithdraw(address(stuck), to, amount);
    }
}
