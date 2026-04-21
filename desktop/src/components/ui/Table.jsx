/**
 * Table — Linear-style list. Compact rows, subtle dividers, hover highlight.
 *
 * Usage:
 *   <Table>
 *     <THead>
 *       <Th>Name</Th><Th width={80}>Status</Th>
 *     </THead>
 *     <TBody>
 *       {rows.map(r => (
 *         <Tr key={r.id} onClick={...}>
 *           <Td>{r.name}</Td><Td>{r.status}</Td>
 *         </Tr>
 *       ))}
 *     </TBody>
 *   </Table>
 */

export function Table({ children, style }) {
  return (
    <table
      style={{
        width: "100%", borderCollapse: "collapse",
        fontSize: 13, color: "var(--n-9)",
        ...style,
      }}
    >
      {children}
    </table>
  );
}

export function THead({ children }) {
  return (
    <thead>
      <tr style={{
        fontSize: 11, fontWeight: 600, textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "var(--n-6)",
        borderBottom: "1px solid var(--n-3)",
      }}>
        {children}
      </tr>
    </thead>
  );
}

export function Th({ children, width, align = "left" }) {
  return (
    <th style={{
      padding: "8px 10px", textAlign: align,
      fontWeight: 600, width,
    }}>
      {children}
    </th>
  );
}

export function TBody({ children }) {
  return <tbody>{children}</tbody>;
}

export function Tr({ children, onClick, selected }) {
  return (
    <tr
      onClick={onClick}
      style={{
        borderBottom: "1px solid var(--n-2)",
        cursor: onClick ? "pointer" : "default",
        background: selected ? "var(--accent-soft)" : "transparent",
        transition: "background var(--dur-fast) var(--ease)",
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = "var(--n-1)";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </tr>
  );
}

export function Td({ children, align = "left", width, title }) {
  return (
    <td
      title={title}
      style={{
        padding: "10px", textAlign: align, width,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}
    >
      {children}
    </td>
  );
}
