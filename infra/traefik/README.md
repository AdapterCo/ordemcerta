# Integração com o Traefik existente (EasyPanel)

Não altere o Traefik nem as portas 80/443/3000 do EasyPanel. Antes do deploy, **inspecione** os nomes efetivos:

```bash
docker ps --format '{{.Names}}\t{{.Image}}' | grep -i traefik
docker inspect <container-traefik> --format '{{json .Config.Cmd}}' | tr ',' '\n' | grep -Ei 'entrypoints|certificatesresolvers|providers.docker'
docker network ls | grep -i traefik
docker inspect <container-traefik> --format '{{json .NetworkSettings.Networks}}'
```

Preencha no `.env`:

- `TRAEFIK_NETWORK` — rede docker do Traefik (ex.: `traefik9`)
- `TRAEFIK_ENTRYPOINT` — entrypoint HTTPS (ex.: `https` ou `websecure`)
- `TRAEFIK_CERT_RESOLVER` — resolver ACME (ex.: `letsencrypt`)

Roteamento (`docker-compose.prod.yml`):

| Router | Regra | Serviço | Prioridade |
|---|---|---|---|
| `oc-api` | `Host(APP_DOMAIN) && (PathPrefix(/api) \|\| PathPrefix(/health))` | api:3001 (inclui WebSocket `/api/v1/realtime`) | 100 |
| `oc-web` | `Host(APP_DOMAIN)` | web:80 | 10 |

Webhooks públicos: `POST /api/v1/webhooks/mercadopago` e `GET/POST /api/v1/webhooks/whatsapp` (assinatura validada na aplicação).

Após subir: `curl -I https://ordemcerta.adapterco.com.br/health/live` deve retornar 200 com certificado válido. Valide DNS/TLS — não presuma.
