FROM nginx:alpine

# nginx's entrypoint runs envsubst on templates/ at startup, which is how
# LOCALIO_CARTO_KEY reaches /config.json.
COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY static/ /usr/share/nginx/html/

# Pipeline output is bind-mounted at /srv/localio-data by docker-compose.yml
