// Burner terminals can be placed on any edge, including inside panes smaller
// than either terminal's preferred size. These tests ensure both terminals
// stay visible and the divider remains adjustable in those constrained panes.

import XCTest
@testable import GhosttyElectronBridge

final class EmbeddedGhosttySplitLengthsTests: XCTestCase {
    func testConstrainedHorizontalSplitKeepsBothTerminalsVisible() {
        let split = embeddedGhosttySplitLengths(
            dimension: 220,
            divider: 6,
            splitRatio: 0.4,
            preferredSecondaryMinimum: 260,
            preferredPrimaryMinimum: 320
        )

        XCTAssertGreaterThan(split.primary, 0)
        XCTAssertGreaterThan(split.secondary, 0)
        XCTAssertEqual(split.primary + split.secondary + split.divider, 220, accuracy: 0.001)
    }

    func testConstrainedVerticalSplitKeepsBothTerminalsVisible() {
        let split = embeddedGhosttySplitLengths(
            dimension: 100,
            divider: 6,
            splitRatio: 0.4,
            preferredSecondaryMinimum: 140,
            preferredPrimaryMinimum: 180
        )

        XCTAssertGreaterThan(split.primary, 0)
        XCTAssertGreaterThan(split.secondary, 0)
        XCTAssertEqual(split.primary + split.secondary + split.divider, 100, accuracy: 0.001)
    }

    func testDividerShrinksBeforeEitherTerminalDisappears() {
        let split = embeddedGhosttySplitLengths(
            dimension: 4,
            divider: 6,
            splitRatio: 0.4,
            preferredSecondaryMinimum: 260,
            preferredPrimaryMinimum: 320
        )

        XCTAssertGreaterThan(split.primary, 0)
        XCTAssertGreaterThan(split.secondary, 0)
        XCTAssertEqual(split.primary + split.secondary + split.divider, 4, accuracy: 0.001)
    }

    func testConstrainedSplitStillRespondsToRatioChanges() {
        let smaller = embeddedGhosttySplitLengths(
            dimension: 220,
            divider: 6,
            splitRatio: 0.3,
            preferredSecondaryMinimum: 260,
            preferredPrimaryMinimum: 320
        )
        let larger = embeddedGhosttySplitLengths(
            dimension: 220,
            divider: 6,
            splitRatio: 0.55,
            preferredSecondaryMinimum: 260,
            preferredPrimaryMinimum: 320
        )

        XCTAssertLessThan(smaller.secondary, larger.secondary)
        XCTAssertGreaterThan(smaller.primary, larger.primary)
    }

    func testCrossingPreferredMinimumBoundaryDoesNotSnap() {
        let horizontalFit = embeddedGhosttySplitLengths(
            dimension: 586,
            divider: 6,
            splitRatio: 0.34,
            preferredSecondaryMinimum: 260,
            preferredPrimaryMinimum: 320
        )
        let horizontalConstrained = embeddedGhosttySplitLengths(
            dimension: 585,
            divider: 6,
            splitRatio: 0.34,
            preferredSecondaryMinimum: 260,
            preferredPrimaryMinimum: 320
        )
        let verticalFit = embeddedGhosttySplitLengths(
            dimension: 326,
            divider: 6,
            splitRatio: 0.34,
            preferredSecondaryMinimum: 140,
            preferredPrimaryMinimum: 180
        )
        let verticalConstrained = embeddedGhosttySplitLengths(
            dimension: 325,
            divider: 6,
            splitRatio: 0.34,
            preferredSecondaryMinimum: 140,
            preferredPrimaryMinimum: 180
        )

        XCTAssertLessThan(abs(horizontalFit.secondary - horizontalConstrained.secondary), 2)
        XCTAssertLessThan(abs(verticalFit.secondary - verticalConstrained.secondary), 2)
    }
}
