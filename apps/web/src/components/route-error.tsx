import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Button } from './ui';

/** Erros de carregamento de página após publicação nova (arquivo da versão antiga não existe mais). */
function isChunkError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /dynamically imported module|Loading chunk|Importing a module script failed|Failed to fetch/i.test(msg);
}

/** Tela de erro das rotas (substitui a página padrão em inglês do React Router). */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const chunk = isChunkError(error);
  if (!notFound && !chunk) console.error(error);

  const title = notFound ? 'Página não encontrada' : chunk ? 'O sistema foi atualizado' : 'Algo deu errado nesta tela';
  const text = notFound
    ? 'O endereço acessado não existe ou foi movido.'
    : chunk
      ? 'Uma versão nova do OrdemCerta foi publicada. Recarregue a página para continuar.'
      : 'Ocorreu um erro inesperado. Recarregue a página; se continuar, avise o suporte informando o que estava fazendo.';

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-white p-6 text-center shadow-card">
        <h1 className="text-xl font-bold text-ink-900">{title}</h1>
        <p className="mt-2 text-sm text-ink-700">{text}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {!notFound && <Button onClick={() => window.location.reload()}>Recarregar</Button>}
          <Link to="/app/dashboard" className="inline-flex items-center rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink-800 hover:bg-paper-2">
            Ir para o painel
          </Link>
        </div>
      </div>
    </div>
  );
}
