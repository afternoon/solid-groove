import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConfirmDialog from "./ConfirmDialog";

afterEach(() => cleanup());

describe("ConfirmDialog", () => {
	it("renders as an alertdialog with the given title and message", () => {
		render(() => (
			<ConfirmDialog
				title="Delete this project?"
				message="This cannot be undone."
				onConfirm={() => {}}
				onCancel={() => {}}
			/>
		));

		expect(
			screen.getByRole("alertdialog", { name: "Delete this project?" }),
		).toBeInTheDocument();
		expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
	});

	it("calls onConfirm when the confirm button is clicked", () => {
		const onConfirm = vi.fn();
		render(() => (
			<ConfirmDialog
				title="Delete?"
				message="Sure?"
				onConfirm={onConfirm}
				onCancel={() => {}}
			/>
		));

		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	it("calls onCancel when Cancel is clicked", () => {
		const onCancel = vi.fn();
		render(() => (
			<ConfirmDialog
				title="Delete?"
				message="Sure?"
				onConfirm={() => {}}
				onCancel={onCancel}
			/>
		));

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("calls onCancel when Escape is pressed", () => {
		const onCancel = vi.fn();
		render(() => (
			<ConfirmDialog
				title="Delete?"
				message="Sure?"
				onConfirm={() => {}}
				onCancel={onCancel}
			/>
		));

		fireEvent.keyDown(document, { key: "Escape" });
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("disables both actions while busy", () => {
		render(() => (
			<ConfirmDialog
				title="Delete?"
				message="Sure?"
				busy
				onConfirm={() => {}}
				onCancel={() => {}}
			/>
		));

		expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
	});

	it("supports custom confirm/cancel labels", () => {
		render(() => (
			<ConfirmDialog
				title="Discard changes?"
				message="Sure?"
				confirmLabel="Discard"
				cancelLabel="Keep editing"
				onConfirm={() => {}}
				onCancel={() => {}}
			/>
		));

		expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Keep editing" }),
		).toBeInTheDocument();
	});
});
