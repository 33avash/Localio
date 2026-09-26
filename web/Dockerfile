FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY static/ /usr/share/nginx/html/

# Pipeline output is bind-mounted at /srv/localio-data by docker-compose.yml
