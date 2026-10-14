export function Breadcrumbs({ items }: { items: { name: string; path?: string }[] }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span key={i}>
          {i > 0 && (
            <span className="sep" aria-hidden="true">
              /
            </span>
          )}
          {it.path ? <a href={it.path}>{it.name}</a> : <span aria-current="page">{it.name}</span>}
        </span>
      ))}
    </nav>
  );
}
