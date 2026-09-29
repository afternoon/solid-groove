import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import DataTable from "./DataTable";

const columns = [
  { label: "Name" },
  { label: "Size", width: "80px" },
  { label: "Actions", hideLabel: true },
];

function renderTable(headHidden = false) {
  return render(() => (
    <DataTable label="Files" columns={columns} class="mine" headHidden={headHidden}>
      <tr>
        <td>a</td>
        <td>1</td>
        <td>x</td>
      </tr>
    </DataTable>
  ));
}

describe("DataTable", () => {
  it("is a labelled table with a column header per column", () => {
    const { getByRole, getAllByRole } = renderTable();
    expect(getByRole("table", { name: "Files" })).toHaveClass("data-table", "mine");
    const headers = getAllByRole("columnheader");
    expect(headers.map((th) => th.textContent)).toEqual(["Name", "Size", "Actions"]);
    for (const th of headers) expect(th).toHaveAttribute("scope", "col");
  });

  it("gives fixed columns their width and leaves the rest to share", () => {
    const { container } = renderTable();
    const cols = [...container.querySelectorAll("col")] as HTMLElement[];
    expect(cols.map((col) => col.style.width)).toEqual(["", "80px", ""]);
  });

  it("keeps a hidden-label column's name for assistive tech", () => {
    const { getByRole } = renderTable();
    expect(getByRole("columnheader", { name: "Actions" }).firstElementChild).toHaveClass(
      "visually-hidden",
    );
  });

  it("can hide its header row from assistive tech", () => {
    const { container } = renderTable(true);
    expect(container.querySelector("thead tr")).toHaveAttribute("aria-hidden", "true");
  });
});
