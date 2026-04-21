// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {Payments} from "../src/Payments.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MOCK") {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract PaymentsTest is Test {
    address internal admin = address(0xA11CE);
    address internal treasury = address(0x7E5);
    address internal deadAddr = 0x000000000000000000000000000000000000dEaD;
    address internal payer = address(0xBEEF);
    address internal streamerOwner = address(0xCAFE);
    address internal stranger = address(0x1337);

    MockToken internal token;
    Payments internal payments;

    uint256 internal constant TIER_1 = 100 ether;
    uint256 internal constant TIER_2 = 500 ether;
    uint256 internal constant TIER_3 = 2_500 ether;
    uint256 internal constant DEPLOY_FEE = 10_000 ether;

    // Mirror events for expectEmit
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

    function setUp() public {
        token = new MockToken();
        payments = new Payments(IERC20(address(token)), treasury, deadAddr, admin);

        vm.startPrank(admin);
        payments.setTierAmount(1, TIER_1);
        payments.setTierAmount(2, TIER_2);
        payments.setTierAmount(3, TIER_3);
        payments.setDeployFee(DEPLOY_FEE);
        vm.stopPrank();

        token.mint(payer, 1_000_000 ether);

        vm.prank(payer);
        token.approve(address(payments), type(uint256).max);
    }

    // -----------------------------------------------------------------
    // Construction
    // -----------------------------------------------------------------

    function test_Constructor_Reverts_OnZeroToken() public {
        vm.expectRevert(Payments.InvalidOwner.selector);
        new Payments(IERC20(address(0)), treasury, deadAddr, admin);
    }

    function test_Constructor_Reverts_OnZeroTreasury() public {
        vm.expectRevert(Payments.InvalidTreasury.selector);
        new Payments(IERC20(address(token)), address(0), deadAddr, admin);
    }

    function test_Constructor_Reverts_OnZeroDead() public {
        vm.expectRevert(Payments.InvalidDeadAddress.selector);
        new Payments(IERC20(address(token)), treasury, address(0), admin);
    }

    function test_Constructor_SetsState() public view {
        assertEq(address(payments.token()), address(token));
        assertEq(payments.treasury(), treasury);
        assertEq(payments.deadAddress(), deadAddr);
        assertEq(payments.owner(), admin);
        assertEq(payments.paused(), false);
    }

    // -----------------------------------------------------------------
    // superChat — each tier splits 90/10
    // -----------------------------------------------------------------

    function _doSuperChat(uint8 tier, uint256 amount) internal {
        bytes32 sid = keccak256("streamer-1");
        bytes32 mh = keccak256("hello world");

        uint256 ownerBefore = token.balanceOf(streamerOwner);
        uint256 treasuryBefore = token.balanceOf(treasury);
        uint256 payerBefore = token.balanceOf(payer);

        uint256 expectedOwner = (amount * 90) / 100;
        uint256 expectedTreasury = amount - expectedOwner;

        vm.expectEmit(true, true, true, true, address(payments));
        emit SuperChat(
            payer, sid, streamerOwner, tier, amount, mh, block.timestamp
        );

        vm.prank(payer);
        payments.superChat(sid, tier, mh, streamerOwner);

        assertEq(token.balanceOf(streamerOwner), ownerBefore + expectedOwner);
        assertEq(token.balanceOf(treasury), treasuryBefore + expectedTreasury);
        assertEq(token.balanceOf(payer), payerBefore - amount);
    }

    function test_SuperChat_Tier1_Splits90_10() public {
        _doSuperChat(1, TIER_1);
    }

    function test_SuperChat_Tier2_Splits90_10() public {
        _doSuperChat(2, TIER_2);
    }

    function test_SuperChat_Tier3_Splits90_10() public {
        _doSuperChat(3, TIER_3);
    }

    function test_SuperChat_Reverts_OnInvalidTierZero() public {
        vm.prank(payer);
        vm.expectRevert(Payments.InvalidTier.selector);
        payments.superChat(bytes32(0), 0, bytes32(0), streamerOwner);
    }

    function test_SuperChat_Reverts_OnInvalidTierFour() public {
        vm.prank(payer);
        vm.expectRevert(Payments.InvalidTier.selector);
        payments.superChat(bytes32(0), 4, bytes32(0), streamerOwner);
    }

    function test_SuperChat_Reverts_WhenTierDisabled() public {
        vm.prank(admin);
        payments.setTierAmount(2, 0);

        vm.prank(payer);
        vm.expectRevert(Payments.TierDisabled.selector);
        payments.superChat(bytes32(0), 2, bytes32(0), streamerOwner);
    }

    function test_SuperChat_Reverts_OnZeroOwner() public {
        vm.prank(payer);
        vm.expectRevert(Payments.InvalidOwner.selector);
        payments.superChat(bytes32(0), 1, bytes32(0), address(0));
    }

    function test_SuperChat_Reverts_WhenPaused() public {
        vm.prank(admin);
        payments.setPaused(true);

        vm.prank(payer);
        vm.expectRevert(Payments.PaymentsPaused.selector);
        payments.superChat(bytes32(0), 1, bytes32(0), streamerOwner);
    }

    function test_SuperChat_Reverts_WhenInsufficientAllowance() public {
        vm.prank(payer);
        token.approve(address(payments), 0);

        vm.prank(payer);
        vm.expectRevert();
        payments.superChat(bytes32(0), 1, bytes32(0), streamerOwner);
    }

    // -----------------------------------------------------------------
    // payDeployFee — splits 20 burn / 80 treasury
    // -----------------------------------------------------------------

    function test_PayDeployFee_Splits_20_80() public {
        bytes32 deployId = keccak256("deploy-1");

        uint256 deadBefore = token.balanceOf(deadAddr);
        uint256 treasuryBefore = token.balanceOf(treasury);
        uint256 payerBefore = token.balanceOf(payer);

        uint256 expectedBurn = (DEPLOY_FEE * 20) / 100;
        uint256 expectedTreasury = DEPLOY_FEE - expectedBurn;

        vm.expectEmit(true, true, false, true, address(payments));
        emit DeployFeePaid(
            payer,
            deployId,
            DEPLOY_FEE,
            expectedBurn,
            expectedTreasury,
            block.timestamp
        );

        vm.prank(payer);
        payments.payDeployFee(deployId);

        assertEq(token.balanceOf(deadAddr), deadBefore + expectedBurn);
        assertEq(token.balanceOf(treasury), treasuryBefore + expectedTreasury);
        assertEq(token.balanceOf(payer), payerBefore - DEPLOY_FEE);
    }

    function test_PayDeployFee_Reverts_WhenDisabled() public {
        vm.prank(admin);
        payments.setDeployFee(0);

        vm.prank(payer);
        vm.expectRevert(Payments.DeployDisabled.selector);
        payments.payDeployFee(bytes32(0));
    }

    function test_PayDeployFee_Reverts_WhenPaused() public {
        vm.prank(admin);
        payments.setPaused(true);

        vm.prank(payer);
        vm.expectRevert(Payments.PaymentsPaused.selector);
        payments.payDeployFee(bytes32(0));
    }

    // -----------------------------------------------------------------
    // Admin gating
    // -----------------------------------------------------------------

    function test_SetTreasury_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        payments.setTreasury(address(0x9999));
    }

    function test_SetTreasury_EmitsAndUpdates() public {
        address newTreasury = address(0x9999);

        vm.expectEmit(false, false, false, true, address(payments));
        emit TreasuryUpdated(treasury, newTreasury);

        vm.prank(admin);
        payments.setTreasury(newTreasury);
        assertEq(payments.treasury(), newTreasury);
    }

    function test_SetTreasury_Reverts_OnZero() public {
        vm.prank(admin);
        vm.expectRevert(Payments.InvalidTreasury.selector);
        payments.setTreasury(address(0));
    }

    function test_SetDeadAddress_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        payments.setDeadAddress(address(0xDEAD));
    }

    function test_SetDeadAddress_EmitsAndUpdates() public {
        address newDead = address(0xDEAD);
        vm.expectEmit(false, false, false, true, address(payments));
        emit DeadAddressUpdated(deadAddr, newDead);

        vm.prank(admin);
        payments.setDeadAddress(newDead);
        assertEq(payments.deadAddress(), newDead);
    }

    function test_SetDeadAddress_Reverts_OnZero() public {
        vm.prank(admin);
        vm.expectRevert(Payments.InvalidDeadAddress.selector);
        payments.setDeadAddress(address(0));
    }

    function test_SetPaused_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        payments.setPaused(true);
    }

    function test_SetPaused_EmitsAndToggles() public {
        vm.expectEmit(false, false, false, true, address(payments));
        emit PausedUpdated(true);

        vm.prank(admin);
        payments.setPaused(true);
        assertTrue(payments.paused());

        vm.prank(admin);
        payments.setPaused(false);
        assertFalse(payments.paused());
    }

    function test_SetTierAmount_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        payments.setTierAmount(1, 1 ether);
    }

    function test_SetTierAmount_Reverts_OnInvalidTier() public {
        vm.prank(admin);
        vm.expectRevert(Payments.InvalidTier.selector);
        payments.setTierAmount(0, 1 ether);

        vm.prank(admin);
        vm.expectRevert(Payments.InvalidTier.selector);
        payments.setTierAmount(4, 1 ether);
    }

    function test_SetTierAmount_EmitsAndUpdates() public {
        vm.expectEmit(false, false, false, true, address(payments));
        emit TierAmountUpdated(1, 777 ether);

        vm.prank(admin);
        payments.setTierAmount(1, 777 ether);
        assertEq(payments.superChatTierAmounts(1), 777 ether);
    }

    function test_SetDeployFee_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        payments.setDeployFee(1 ether);
    }

    function test_SetDeployFee_EmitsAndUpdates() public {
        vm.expectEmit(false, false, false, true, address(payments));
        emit DeployFeeUpdated(42 ether);

        vm.prank(admin);
        payments.setDeployFee(42 ether);
        assertEq(payments.deployFeeAmount(), 42 ether);
    }

    // -----------------------------------------------------------------
    // Emergency withdraw
    // -----------------------------------------------------------------

    function test_EmergencyWithdraw_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        payments.emergencyWithdraw(IERC20(address(token)), stranger, 1 ether);
    }

    function test_EmergencyWithdraw_Reverts_OnZeroTo() public {
        vm.prank(admin);
        vm.expectRevert(Payments.InvalidTreasury.selector);
        payments.emergencyWithdraw(IERC20(address(token)), address(0), 1 ether);
    }

    function test_EmergencyWithdraw_RescuesStuckTokens() public {
        // Simulate stuck tokens: transfer directly to the contract.
        token.mint(address(payments), 5 ether);
        uint256 before = token.balanceOf(address(this));

        vm.expectEmit(true, true, false, true, address(payments));
        emit EmergencyWithdraw(address(token), address(this), 5 ether);

        vm.prank(admin);
        payments.emergencyWithdraw(IERC20(address(token)), address(this), 5 ether);

        assertEq(token.balanceOf(address(this)), before + 5 ether);
        assertEq(token.balanceOf(address(payments)), 0);
    }

    // -----------------------------------------------------------------
    // Fuzz: super chat preserves totals across all tiers
    // -----------------------------------------------------------------

    function testFuzz_SuperChat_TotalsPreserved(uint8 tier, uint256 amount) public {
        tier = uint8(bound(uint256(tier), 1, 3));
        amount = bound(amount, 1, token.balanceOf(payer));

        vm.prank(admin);
        payments.setTierAmount(tier, amount);

        uint256 totalBefore = token.balanceOf(streamerOwner) + token.balanceOf(treasury);

        vm.prank(payer);
        payments.superChat(bytes32(0), tier, bytes32(0), streamerOwner);

        uint256 totalAfter = token.balanceOf(streamerOwner) + token.balanceOf(treasury);
        assertEq(totalAfter - totalBefore, amount);
    }
}
