# Elasticsearch for Railway: same version as local dev, data on a Railway volume at /esdata.
# Railway volumes are mounted root-owned while ES refuses to run as root, so the entrypoint starts as
# root, hands the volume to the elasticsearch user and drops privileges (coreutils chroot --userspec).
FROM docker.elastic.co/elasticsearch/elasticsearch:9.5.5

COPY elasticsearch.yml /usr/share/elasticsearch/config/elasticsearch.yml
COPY --chmod=755 entrypoint.sh /usr/local/bin/railway-entrypoint.sh

USER 0
ENTRYPOINT ["/usr/local/bin/railway-entrypoint.sh"]
