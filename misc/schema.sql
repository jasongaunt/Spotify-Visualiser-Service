CREATE TABLE `spotify_sessions` (
	`sid` VARCHAR(32) NOT NULL COLLATE 'latin1_swedish_ci',
	`access_token` VARCHAR(255) NOT NULL COLLATE 'latin1_swedish_ci',
	`expires` DATETIME NOT NULL,
	`refresh_token` VARCHAR(255) NOT NULL COLLATE 'latin1_swedish_ci',
	PRIMARY KEY (`sid`) USING BTREE
)
COLLATE='latin1_swedish_ci'
ENGINE=InnoDB
;
